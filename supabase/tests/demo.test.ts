import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asCommitted, createTestDatabase, query, user, userAal2, type Actor } from './harness'

/** Phase 17: demo content and the demo reset (migration 24). */

const U = {
  platformOwner: '98000000-0000-4000-8000-0000000000f1',
  support: '98000000-0000-4000-8000-0000000000f2',
  demoOwner: '98000000-0000-4000-8000-00000000000a',
  student: '98000000-0000-4000-8000-0000000000a1',
  realOwner: '98000000-0000-4000-8000-00000000000b',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let demo: string
let real: string
const reset = (actor: Actor, slug: string) => asCommitted(pool, actor, (c) => c.query(`select public.platform_demo_reset($1) as r`, [slug])).then((r) => r.rows[0].r)
const counts = async (tenant: string) =>
  (
    await pool.query(
      `select (select count(*)::int from public.admission_programs where tenant_id = $1 and status = 'published') as programs,
              (select count(*)::int from public.campus_locations where tenant_id = $1 and published) as locations,
              (select count(*)::int from public.courses where tenant_id = $1) as courses,
              (select count(*)::int from public.workflow_definitions d join public.workflow_versions v on v.id = d.current_version_id where d.tenant_id = $1 and v.status = 'published') as forms,
              (select count(*)::int from public.ticket_categories where tenant_id = $1) as categories,
              (select count(*)::int from public.tickets where tenant_id = $1) as tickets`,
      [tenant],
    )
  ).rows[0]

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  await pool.query(`insert into public.platform_admins (user_id, role) values ($1, 'owner'), ($2, 'support')`, [U.platformOwner, U.support])
  demo = (await pool.query(`select public.create_tenant('demo-uni', 'Demo University', $1, 'en', 'UTC', true) as id`, [U.demoOwner])).rows[0].id
  real = (await pool.query(`select public.create_tenant('real-uni', 'Real University', $1) as id`, [U.realOwner])).rows[0].id
  const m = (await pool.query(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [demo, U.student])).rows[0].id
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = 'student'`, [demo, m])
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('demo content', () => {
  it('fills a demo university once, and refuses real universities', async () => {
    await pool.query(`select app.demo_seed($1)`, [demo])
    const first = await counts(demo)
    expect(first).toEqual({ programs: 3, locations: 5, courses: 1, forms: 1, categories: 3, tickets: 0 })
    await pool.query(`select app.demo_seed($1)`, [demo])
    expect(await counts(demo)).toEqual(first) // idempotent
    await expect(pool.query(`select app.demo_seed($1)`, [real])).rejects.toMatchObject({ code: '42501' })
    expect(await counts(real)).toMatchObject({ programs: 0, locations: 0 })
    // The demo content is usable by members.
    expect((await query(pool, user(U.student), `select public.campus_search('demo-uni', 'library', null, 10) as r`)).rows[0].r.length).toBeGreaterThan(0)
  })
})

describe('demo reset', () => {
  it('only platform owners and admins, only demo universities', async () => {
    for (const actor of [U.support, U.demoOwner, U.student]) await expect(reset(user(actor), 'demo-uni')).rejects.toMatchObject({ code: '42501' })
    await expect(reset(user(U.platformOwner), 'real-uni')).rejects.toMatchObject({ code: '42501' })
    await expect(reset(user(U.platformOwner), 'nope')).rejects.toMatchObject({ code: 'P0002' })
  })

  it('removes demo activity, restores deleted demo content, keeps members and settings', async () => {
    const ticket = await asCommitted(pool, user(U.student), (c) => c.query(`select public.ticket_create('demo-uni', 'Where is my transcript?', 'Please help', null, 'portal', null) as id`)).catch(() => null)
    if (!ticket) await pool.query(`insert into public.tickets (tenant_id, reference, subject, source, requester_id, requester_name) values ($1, 'T-00001', 'Where is my transcript?', 'portal', $2, 'Student')`, [demo, U.student])
    await pool.query(`insert into public.ai_usage_events (tenant_id, feature, model, cost_usd) values ($1, 'student_assistant', 'claude-test', 0.2), ($2, 'student_assistant', 'claude-test', 0.2)`, [demo, real])
    await pool.query(`delete from public.campus_locations where tenant_id = $1 and code = 'C'`, [demo])
    await pool.query(`delete from public.campus_locations where tenant_id = $1`, [demo])
    expect((await counts(demo)).tickets).toBe(1)

    const result = await reset(userAal2(U.platformOwner), 'demo-uni')
    expect(result.deleted).toBeGreaterThanOrEqual(2)
    expect(await counts(demo)).toEqual({ programs: 3, locations: 5, courses: 1, forms: 1, categories: 3, tickets: 0 })
    expect((await pool.query(`select count(*)::int as n from public.ai_usage_events where tenant_id = $1`, [demo])).rows[0].n).toBe(0)
    expect((await pool.query(`select count(*)::int as n from public.ai_usage_events where tenant_id = $1`, [real])).rows[0].n).toBe(1) // other universities untouched
    expect((await pool.query(`select count(*)::int as n from public.tenant_memberships where tenant_id = $1`, [demo])).rows[0].n).toBe(2)
    expect((await pool.query(`select action from public.audit_logs where action = 'demo.reset'`)).rows).toHaveLength(1)
  })
})
