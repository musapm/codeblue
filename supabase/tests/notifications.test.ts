import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 14 database tests: notification preferences (in-app by default, email only when
 * chosen), the email outbox (references only, never readable by members), and the
 * integration framework (managers only, no secrets in settings, activation needs a secret
 * reference, logs, audit, other universities, the feature switch).
 */

const U = {
  owner: '94000000-0000-4000-8000-00000000000a',
  staff: '94000000-0000-4000-8000-0000000000a1',
  student: '94000000-0000-4000-8000-0000000000a2',
  ownerB: '94000000-0000-4000-8000-00000000000b',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let ticket: string

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(`select ${sql} as r`, params)).then((r) => r.rows[0].r)

async function addMember(tenant: string, userId: string, roleKey: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
}

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  await pool.query(`select public.create_tenant('uni-b', 'University B', $1)`, [U.ownerB])
  await addMember(tenantA, U.staff, 'registrar')
  await addMember(tenantA, U.student, 'student')
  ticket = (
    await pool.query(
      `insert into public.tickets (tenant_id, reference, subject, status, priority, source, requester_id, requester_name) values ($1, 'T-00001', 'Transcript', 'open', 'normal', 'portal', $2, 'Sara') returning id`,
      [tenantA, U.student],
    )
  ).rows[0].id
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('notification preferences', () => {
  it('in-app by default, email only when chosen; each person sees only their own', async () => {
    const prefs = (await rpc(user(U.student), `public.my_notification_preferences('uni-a')`)) as { kind: string; in_app: boolean; email: boolean }[]
    expect(prefs).toHaveLength(8)
    expect(prefs.every((p) => p.in_app && !p.email)).toBe(true)
    await run(user(U.student), `public.set_notification_preference('uni-a', 'ticket_status', true, true)`)
    await run(user(U.student), `public.set_notification_preference('uni-a', 'ticket_reply', false, false)`)
    expect((await query(pool, user(U.student), `select kind from public.notification_preferences order by kind`)).rows.map((r) => r.kind)).toEqual(['ticket_reply', 'ticket_status'])
    expect((await query(pool, user(U.staff), `select count(*)::int as n from public.notification_preferences`)).rows[0].n).toBe(0)
    await expect(run(user(U.student), `public.set_notification_preference('uni-a', 'marketing', true, true)`)).rejects.toMatchObject({ code: '23514' })
    await expect(run(user(U.ownerB), `public.set_notification_preference('uni-a', 'ticket_status', true, true)`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.my_notification_preferences('uni-a')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('notifications follow the choices: muted kinds are not shown, email kinds are queued by reference only', async () => {
    await pool.query(`select app.notify($1, array[$2]::uuid[], 'ticket_status', $3)`, [tenantA, U.student, ticket])
    await pool.query(`select app.notify($1, array[$2]::uuid[], 'ticket_reply', $3)`, [tenantA, U.student, ticket])
    await pool.query(`select app.notify($1, array[$2]::uuid[], 'ticket_assigned', $3)`, [tenantA, U.staff, ticket])
    const shown = (await pool.query(`select user_id, kind from public.notifications order by id`)).rows
    expect(shown).toEqual([
      { user_id: U.student, kind: 'ticket_status' },
      { user_id: U.staff, kind: 'ticket_assigned' },
    ])
    const queued = (await pool.query(`select user_id, kind, ticket_id, request_id, status from public.outbound_messages`)).rows
    expect(queued).toEqual([{ user_id: U.student, kind: 'ticket_status', ticket_id: ticket, request_id: null, status: 'queued' }])
  })

  it('the outbox is never readable by members; administrators see numbers only', async () => {
    for (const actor of [U.owner, U.student]) await expect(query(pool, user(actor), `select * from public.outbound_messages`)).rejects.toMatchObject({ code: '42501' })
    expect(await rpc(user(U.owner), `public.outbox_summary('uni-a')`)).toMatchObject({ queued: 1, sent: 0, failed: 0 })
    await expect(rpc(user(U.staff), `public.outbox_summary('uni-a')`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('integrations', () => {
  let id: string
  const save = (actor: Actor, config: unknown = { base_url: 'https://lms.uni.example' }, secretRef: string | null = null, existing: string | null = null) =>
    run(actor, `public.integration_save('uni-a', $1, 'lms', 'Moodle', $2, $3)`, [existing, JSON.stringify(config), secretRef])

  it('only integration managers create them; settings never hold secrets', async () => {
    for (const actor of [U.staff, U.student, U.ownerB]) await expect(save(user(actor))).rejects.toMatchObject({ code: '42501' })
    id = await save(user(U.owner))
    for (const bad of [{ api_key: 'x' }, { Password: 'x' }, { client_secret: 'x' }, { access_token: 'x' }]) await expect(save(user(U.owner), bad, null, id)).rejects.toMatchObject({ code: '23514' })
    await expect(save(user(U.owner), {}, 'not a name', id)).rejects.toMatchObject({ code: '23514' })
  })

  it('activation needs a secret reference; every change is logged for managers only', async () => {
    await expect(run(user(U.owner), `public.integration_set_status($1, 'active')`, [id])).rejects.toMatchObject({ code: '22023' })
    await save(user(U.owner), { base_url: 'https://lms.uni.example' }, 'MOODLE_UNI_A_TOKEN', id)
    await run(user(U.owner), `public.integration_set_status($1, 'active')`, [id])
    await expect(run(user(U.owner), `public.integration_set_status($1, 'error')`, [id])).rejects.toMatchObject({ code: '22023' }) // set by connectors, not people
    const events = (await query(pool, user(U.owner), `select event, message from public.integration_logs where integration_id = $1 order by id`, [id])).rows
    expect(events.map((e) => e.event)).toEqual(['integration.created', 'integration.updated', 'integration.status'])
    for (const actor of [U.staff, U.ownerB]) {
      expect((await query(pool, user(actor), `select count(*)::int as n from public.integrations`)).rows[0].n).toBe(0)
      expect((await query(pool, user(actor), `select count(*)::int as n from public.integration_logs`)).rows[0].n).toBe(0)
    }
    const audit = (await pool.query(`select distinct action from public.audit_logs where action like 'integrations.%'`)).rows.map((r) => r.action).sort()
    expect(audit).toEqual(['integrations.insert', 'integrations.update'])
  })

  it('without the feature nothing is visible or possible; deleting removes the logs', async () => {
    await pool.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'integrations'`, [tenantA])
    expect((await query(pool, user(U.owner), `select count(*)::int as n from public.integrations`)).rows[0].n).toBe(0)
    await expect(save(user(U.owner))).rejects.toMatchObject({ code: '42501' })
    await pool.query(`update public.tenant_features set enabled = true where tenant_id = $1 and feature_key = 'integrations'`, [tenantA])
    await run(user(U.owner), `public.integration_delete($1)`, [id])
    expect((await pool.query(`select count(*)::int as n from public.integration_logs where integration_id = $1`, [id])).rows[0].n).toBe(0)
  })
})
