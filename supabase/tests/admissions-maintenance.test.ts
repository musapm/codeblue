import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asCommitted, createTestDatabase, query, user, visitor, type Actor } from './harness'

/**
 * Migration 12 (admissions maintenance): the audited export of one inquiry for access requests,
 * and the cleanup of old anonymous visitor accounts.
 */

const U = {
  owner: '50000000-0000-4000-8000-00000000000a',
  staff: '50000000-0000-4000-8000-0000000000a1',
  student: '50000000-0000-4000-8000-0000000000a3',
  otherStaff: '50000000-0000-4000-8000-0000000000b1',
  oldVisitor: '50000000-0000-4000-8000-0000000000f1',
  newVisitor: '50000000-0000-4000-8000-0000000000f2',
  oldAccount: '50000000-0000-4000-8000-0000000000e1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenant: string
let leadId: string
let oldConversation: string

async function addMember(t: string, userId: string, roleKey: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [t, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [t, rows[0]!.id, roleKey])
}

const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(sql, params)).then((r) => r.rows[0])

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [[U.owner, U.staff, U.student, U.otherStaff]])
  // An old regular account must never be removed by the visitor cleanup.
  await pool.query(`insert into auth.users (id, email, email_confirmed_at, created_at) values ($1, 'old@test.example', now(), now() - interval '90 days')`, [U.oldAccount])
  await pool.query(`insert into auth.users (id, is_anonymous, created_at, last_sign_in_at) values ($1, true, now() - interval '60 days', now() - interval '45 days'), ($2, true, now() - interval '60 days', now() - interval '1 day')`, [U.oldVisitor, U.newVisitor])
  tenant = (await pool.query(`select public.create_tenant('uni-m', 'University M', $1) as id`, [U.owner])).rows[0].id
  const other = (await pool.query(`select public.create_tenant('uni-n', 'University N', $1) as id`, [U.otherStaff])).rows[0].id
  await addMember(tenant, U.staff, 'admissions_staff')
  await addMember(tenant, U.student, 'student')
  void other

  await run(user(U.staff), `select public.admissions_update_settings('uni-m', true, 'admissions@uni-m.example', null, null, null, null, null)`)
  await run(user(U.owner), `select public.admissions_update_assistant('uni-m', true, null, 50, 20)`)
  const program = (await run(user(U.staff), `insert into public.admission_programs (tenant_id, code, name, status) values ($1, 'LAW', 'Law', 'published') returning id`, [tenant])).id
  oldConversation = (await run(visitor(U.oldVisitor), `select public.admissions_begin_turn('uni-m', null, 'Is there a law program?') as r`)).r.conversation_id
  await run(visitor(U.oldVisitor), `select public.assistant_complete_turn($1, 'Yes, Law. [1]', 'answered', '[]', '[]', 'claude-opus-5-5', $2, 500)`, [
    oldConversation,
    JSON.stringify({ input_tokens: 100, output_tokens: 10, cost_usd: 0.01 }),
  ])
  await run(
    visitor(U.oldVisitor),
    `select public.admissions_submit_lead('uni-m', 'Hiba Salih', 'hiba@example.test', '+249 911 111 111', 'Sudan', $1, 'Sept 2027', 'Please call me', 'ar', 'default-1', 'Default wording shown by the app.', $2)`,
    [program, oldConversation],
  )
  leadId = (await pool.query(`select id from public.admission_leads where tenant_id = $1`, [tenant])).rows[0].id
  await run(user(U.staff), `select public.admissions_add_note($1, 'Called on Monday')`, [leadId])
  await run(user(U.staff), `select public.admissions_update_lead($1, 'contacted', null, $2, $3)`, [leadId, U.staff, program])
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('export of one inquiry (access requests)', () => {
  it('returns everything stored about the person, without internal identifiers', async () => {
    const r = (await run(user(U.staff), `select public.admissions_export_lead($1) as r`, [leadId])).r
    expect(r.university).toBe('University M')
    expect(r.inquiry).toMatchObject({ reference: 'L-00001', full_name: 'Hiba Salih', email: 'hiba@example.test', phone: '+249 911 111 111', source: 'assistant', stage: 'contacted', preferred_language: 'ar' })
    expect(r.inquiry.program).toEqual({ code: 'LAW', name: 'Law', name_ar: null })
    expect(r.consent).toMatchObject({ version: 'default-1', wording: 'Default wording shown by the app.' })
    expect(r.notes.map((n: { text: string }) => n.text)).toEqual(['Called on Monday'])
    expect(r.history.map((e: { event: string }) => e.event)).toEqual(['created', 'note', 'stage', 'assigned'])
    expect(JSON.stringify(r.history)).not.toContain(U.staff)
  })

  it('is refused without leads.read in that university', async () => {
    for (const actor of [user(U.student), user(U.otherStaff), visitor(U.newVisitor)]) {
      await expect(query(pool, actor, `select public.admissions_export_lead($1)`, [leadId])).rejects.toMatchObject({ code: '42501' })
    }
  })

  it('every export is audited with the reference only', async () => {
    const rows = (await pool.query(`select actor_id, metadata from public.audit_logs where action = 'admission_leads.export'`)).rows
    expect(rows).toEqual([{ actor_id: U.staff, metadata: { reference: 'L-00001' } }])
  })
})

describe('cleanup of old anonymous visitors', () => {
  it('cannot be called through the API', async () => {
    for (const actor of [user(U.owner), visitor(U.newVisitor)]) {
      await expect(query(pool, actor, `select app.cleanup_anonymous_visitors(30)`)).rejects.toMatchObject({ code: '42501' })
    }
  })

  it('refuses a retention shorter than 7 days', async () => {
    await expect(pool.query(`select app.cleanup_anonymous_visitors(1)`)).rejects.toMatchObject({ code: '22023' })
  })

  it('removes only anonymous visitors unused for the period; inquiries and costs stay', async () => {
    const removed = (await pool.query(`select app.cleanup_anonymous_visitors(30) as n`)).rows[0].n
    expect(removed).toBe(1)
    const ids = (await pool.query(`select id from auth.users`)).rows.map((r) => r.id)
    expect(ids).not.toContain(U.oldVisitor)
    expect(ids).toEqual(expect.arrayContaining([U.newVisitor, U.oldAccount, U.owner]))
    expect((await pool.query(`select count(*)::int as n from public.assistant_conversations where id = $1`, [oldConversation])).rows[0].n).toBe(0)
    const lead = (await pool.query(`select submitted_by, conversation_id, full_name from public.admission_leads where id = $1`, [leadId])).rows[0]
    expect(lead).toEqual({ submitted_by: null, conversation_id: null, full_name: 'Hiba Salih' })
    const usage = (await pool.query(`select user_id, cost_usd from public.ai_usage_events where tenant_id = $1`, [tenant])).rows
    expect(usage).toEqual([{ user_id: null, cost_usd: '0.010000' }])
  })
})
