import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 12 (campus map and assistant) database tests: who manages locations; checks on hours,
 * accessibility, contact details, coordinates and buildings; drafts hidden from members;
 * search that folds Arabic variants and ignores question words; the AI answers' gate;
 * usage, analytics and audit; other universities and the feature switch.
 */

const U = {
  owner: '92000000-0000-4000-8000-00000000000a', // campus.manage and assistant.configure (all permissions)
  staff: '92000000-0000-4000-8000-0000000000a1',
  student: '92000000-0000-4000-8000-0000000000a2',
  student2: '92000000-0000-4000-8000-0000000000a3',
  ownerB: '92000000-0000-4000-8000-00000000000b',
  studentB: '92000000-0000-4000-8000-0000000000b1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
const L: Record<string, string> = {}

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(`select ${sql} as r`, params)).then((r) => r.rows[0].r)
const count = async (actor: Actor, table: string, where = 'true', params: unknown[] = []) =>
  (await query(pool, actor, `select count(*)::int as n from ${table} where ${where}`, params)).rows[0].n as number

async function addMember(tenant: string, userId: string, roleKey: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
}

const save = (actor: Actor, data: Record<string, unknown>, id: string | null = null, slug = 'uni-a') =>
  run(actor, `public.campus_save_location($1, $2, $3)`, [slug, id, JSON.stringify(data)])
const publish = (id: string, on = true) => run(user(U.owner), `public.campus_set_published($1, $2)`, [id, on])
const names = async (actor: Actor, q: string, kind: string | null = null) =>
  ((await rpc(actor, `public.campus_search('uni-a', $1, $2, 20)`, [q, kind])) as { name: string }[]).map((l) => l.name)

const HOURS = { sun: [['08:00', '16:00']], mon: [['08:00', '12:00'], ['13:00', '16:00']], tue: [['08:00', '16:00']] }

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  await addMember(tenantA, U.staff, 'registrar')
  await addMember(tenantA, U.student, 'student')
  await addMember(tenantA, U.student2, 'student')
  await addMember(tenantB, U.studentB, 'student')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('locations are managed with campus.manage', () => {
  it('only campus managers create and edit locations', async () => {
    for (const actor of [U.staff, U.student, U.ownerB]) {
      await expect(save(user(actor), { kind: 'building', name: 'Main Building' })).rejects.toMatchObject({ code: '42501' })
    }
    L.main = await save(user(U.owner), {
      kind: 'building',
      name: 'Main Building',
      name_ar: 'المبنى الرئيسي',
      code: 'B1',
      latitude: '15.5900',
      longitude: '32.5300',
      aliases: ['Admin building', 'المبنى الإداري'],
      accessibility: { step_free_entrance: true, elevator: true },
    })
    L.registry = await save(user(U.owner), {
      kind: 'office',
      name: 'Registrar’s Office',
      name_ar: 'مكتب التسجيل',
      parent_id: L.main,
      floor: '1',
      opening_hours: HOURS,
      hours_note: 'Closed on public holidays',
      phone: '+249 123 456 789',
      email: 'Registry@Uni.example',
      aliases: ['transcripts', 'enrollment certificates'],
    })
    L.library = await save(user(U.owner), { kind: 'library', name: 'Central Library', name_ar: 'المكتبة المركزية', code: 'LIB', latitude: '15.5910', longitude: '32.5320', description: 'Books, study rooms and printing' })
    L.clinic = await save(user(U.owner), { kind: 'clinic', name: 'Student Clinic', description: 'First aid and nurse' })
    const row = (await pool.query(`select email, aliases, opening_hours from public.campus_locations where id = $1`, [L.registry])).rows[0]
    expect(row.email).toBe('registry@uni.example')
    expect(row.opening_hours).toEqual(HOURS)
    await save(user(U.owner), { kind: 'office', name: 'Registry Office', parent_id: L.main }, L.registry)
    expect((await pool.query(`select name, opening_hours from public.campus_locations where id = $1`, [L.registry])).rows[0]).toEqual({ name: 'Registry Office', opening_hours: null })
    await save(user(U.owner), { kind: 'office', name: 'Registrar’s Office', name_ar: 'مكتب التسجيل', parent_id: L.main, floor: '1', opening_hours: HOURS, aliases: ['transcripts'] }, L.registry)
  })

  it('checks hours, accessibility, contact details, coordinates, aliases and buildings', async () => {
    const bad: Record<string, unknown>[] = [
      { kind: 'tower', name: 'X building' },
      { kind: 'office', name: 'X' },
      { kind: 'office', name: 'Office', opening_hours: { monday: [['08:00', '16:00']] } },
      { kind: 'office', name: 'Office', opening_hours: { mon: [['16:00', '08:00']] } },
      { kind: 'office', name: 'Office', opening_hours: { mon: [['8:00', '16:00']] } },
      { kind: 'office', name: 'Office', opening_hours: { mon: [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00'], ['14:00', '15:00']] } },
      { kind: 'office', name: 'Office', accessibility: { elevator: 'yes' } },
      { kind: 'office', name: 'Office', accessibility: { teleporter: true } },
      { kind: 'office', name: 'Office', phone: 'call me' },
      { kind: 'office', name: 'Office', email: 'nope' },
      { kind: 'office', name: 'Office', url: 'http://insecure.example' },
      { kind: 'office', name: 'Office', latitude: '15.5' },
      { kind: 'office', name: 'Office', latitude: '95', longitude: '32' },
      { kind: 'office', name: 'Office', aliases: ['x'.repeat(81)] },
    ]
    for (const data of bad) await expect(save(user(U.owner), data)).rejects.toMatchObject({ code: expect.stringMatching(/^(23514|22023|22P02)$/) })
    // Only buildings contain locations; buildings are not inside anything.
    await expect(save(user(U.owner), { kind: 'office', name: 'Office', parent_id: L.library })).rejects.toMatchObject({ code: '22023' })
    await expect(save(user(U.owner), { kind: 'building', name: 'Annex', parent_id: L.main })).rejects.toMatchObject({ code: '22023' })
    await expect(save(user(U.owner), { kind: 'office', name: 'Main Building' }, L.main)).rejects.toMatchObject({ code: '22023' }) // it has rooms
    await expect(save(user(U.owner), { kind: 'office', name: 'Elsewhere', parent_id: L.main }, null, 'uni-b')).rejects.toMatchObject({ code: '42501' })
  })

  it('drafts are visible to managers only; published locations to members of that university', async () => {
    expect(await count(user(U.student), 'public.campus_locations')).toBe(0)
    expect(await count(user(U.owner), 'public.campus_locations')).toBe(4)
    await expect(run(user(U.staff), `public.campus_set_published($1, true)`, [L.main])).rejects.toMatchObject({ code: '42501' })
    for (const id of [L.main, L.registry, L.library]) await publish(id)
    expect(await count(user(U.student), 'public.campus_locations')).toBe(3)
    for (const actor of [U.ownerB, U.studentB]) expect(await count(user(actor), 'public.campus_locations')).toBe(0)
    await expect(query(pool, anon, `select * from public.campus_locations`)).rejects.toMatchObject({ code: '42501' })
    await expect(rpc(user(U.studentB), `public.campus_search('uni-a', 'library', null, 10)`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('search', () => {
  it('finds names, codes and aliases in both languages, ignoring Arabic letter variants and question words', async () => {
    expect(await names(user(U.student), 'Where is the library?')).toEqual(['Central Library'])
    expect(await names(user(U.student), 'أين المكتبة')).toEqual(['Central Library'])
    // Substring matching is forgiving with Arabic word forms: مكتب is also inside المكتبة, which ranks lower.
    expect(await names(user(U.student), 'مكتب  التسجيل')).toEqual(['Registrar’s Office', 'Central Library'])
    expect(await names(user(U.student), 'transcripts')).toEqual(['Registrar’s Office'])
    expect(await names(user(U.student), 'المبنى الاداري')).toEqual(['Main Building']) // alias with إ written as ا
    expect(await names(user(U.student), 'lib')).toEqual(['Central Library']) // the code ranks first
    expect(await names(user(U.student), 'printing')).toEqual(['Central Library']) // description
  })

  it('lists everything published without a query, filters by kind, never drafts', async () => {
    expect((await names(user(U.student), '')).sort()).toEqual(['Central Library', 'Main Building', 'Registrar’s Office'])
    expect(await names(user(U.student), '', 'office')).toEqual(['Registrar’s Office'])
    expect(await names(user(U.student), 'clinic')).toEqual([]) // not published
    expect(await names(user(U.student), 'zzz')).toEqual([])
  })

  it('deleting a building keeps the locations inside it', async () => {
    const annex = await save(user(U.owner), { kind: 'building', name: 'Annex' })
    const room = await save(user(U.owner), { kind: 'classroom', name: 'Room A1', parent_id: annex })
    await expect(run(user(U.staff), `public.campus_delete_location($1)`, [annex])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.owner), `public.campus_delete_location($1)`, [annex])
    expect((await pool.query(`select parent_id from public.campus_locations where id = $1`, [room])).rows[0].parent_id).toBeNull()
  })
})

describe('AI campus answers, usage and analytics', () => {
  const settings = (actor: Actor, enabled: boolean, budget = 5, limit = 30) => run(actor, `public.campus_update_settings('uni-a', $1, $2, $3)`, [enabled, budget, limit])

  it('are off until an assistant administrator turns them on; then budget and daily limit apply', async () => {
    await expect(run(user(U.student), `public.campus_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '55000' })
    for (const actor of [U.staff, U.student, U.ownerB]) await expect(settings(user(actor), true)).rejects.toMatchObject({ code: '42501' })
    await settings(user(U.owner), true)
    expect(await rpc(user(U.student), `public.campus_status('uni-a')`)).toEqual({ feature: true, ai_enabled: true, ai_within_budget: true })
    await run(user(U.student), `public.campus_ai_begin('uni-a')`)
    await run(user(U.student), `public.campus_ai_record('uni-a', 'claude-opus-5-5', '{"input_tokens": 900, "output_tokens": 120, "cost_usd": 0.006}')`)
    await settings(user(U.owner), true, 5, 1)
    await expect(run(user(U.student), `public.campus_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '54000' })
    await run(user(U.student2), `public.campus_ai_begin('uni-a')`)
    await settings(user(U.owner), true, 0, 30)
    await expect(run(user(U.student2), `public.campus_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '53400' })
    await settings(user(U.owner), true, 5, 30)
    await expect(run(user(U.studentB), `public.campus_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    expect(await count(user(U.student), 'public.campus_settings')).toBe(0)
  })

  it('usage, analytics cost and budget; locations audited', async () => {
    expect(await rpc(user(U.owner), `public.campus_usage('uni-a')`)).toMatchObject({ locations: 5, published: 3, questions: 1 })
    await expect(rpc(user(U.staff), `public.campus_usage('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    const a = await rpc(user(U.owner), `public.analytics_overview('uni-a', 7)`)
    expect(a.ai.month.campus_assistant).toBeGreaterThan(0)
    expect(a.ai.budgets.campus_assistant).toBe(5)
    const actions = (await pool.query(`select distinct action from public.audit_logs where action like 'campus_%' order by action`)).rows.map((r) => r.action)
    expect(actions).toEqual(expect.arrayContaining(['campus_locations.insert', 'campus_locations.update', 'campus_locations.delete', 'campus_settings.insert']))
  })

  it('without the feature nothing is visible or possible', async () => {
    await pool.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'campus_assistant'`, [tenantA])
    expect(await count(user(U.owner), 'public.campus_locations')).toBe(0)
    await expect(rpc(user(U.student), `public.campus_search('uni-a', 'library', null, 10)`)).rejects.toMatchObject({ code: '42501' })
    await expect(save(user(U.owner), { kind: 'gate', name: 'North Gate' })).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.student), `public.campus_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    await pool.query(`update public.tenant_features set enabled = true where tenant_id = $1 and feature_key = 'campus_assistant'`, [tenantA])
    expect(tenantB).toBeTruthy()
  })
})
