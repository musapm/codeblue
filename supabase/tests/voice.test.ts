import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 13 (voice) database tests: off by default and switched on with assistant.configure;
 * who may use voice in which chat; usage booked separately with the cost computed from the
 * university's own prices (never the caller's); the server provider's budget and daily limit;
 * usage figures without content; analytics; audit; other universities and the feature switch.
 */

const U = {
  owner: '93000000-0000-4000-8000-00000000000a',
  staff: '93000000-0000-4000-8000-0000000000a1', // assistant.staff.use
  student: '93000000-0000-4000-8000-0000000000a2',
  student2: '93000000-0000-4000-8000-0000000000a3',
  ownerB: '93000000-0000-4000-8000-00000000000b',
  studentB: '93000000-0000-4000-8000-0000000000b1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(`select ${sql} as r`, params)).then((r) => r.rows[0].r)

async function addMember(tenant: string, userId: string, roleKey: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
}

type Settings = { enabled?: boolean; input?: boolean; output?: boolean; provider?: string; inPrice?: number | null; outPrice?: number | null; budget?: number; daily?: number }
const settings = (actor: Actor, s: Settings = {}) =>
  run(actor, `public.voice_update_settings('uni-a', $1, $2, $3, $4, $5, $6, $7, $8)`, [
    s.enabled ?? true,
    s.input ?? true,
    s.output ?? true,
    s.provider ?? 'browser',
    s.inPrice ?? null,
    s.outPrice ?? null,
    s.budget ?? 5,
    s.daily ?? 600,
  ])
const record = (actor: Actor, kind: string, provider: string, seconds: number, characters: number, surface = 'student_chat', slug = 'uni-a') =>
  run(actor, `public.voice_record($1, $2, $3, $4, $5, $6)`, [slug, surface, kind, provider, seconds, characters])
const costs = async () => (await pool.query(`select kind, provider, seconds::float, characters, cost_usd::float from public.voice_usage_events order by id`)).rows

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  const tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  await addMember(tenantA, U.staff, 'registrar')
  await addMember(tenantA, U.student, 'student')
  await addMember(tenantA, U.student2, 'student')
  await addMember(tenantB, U.studentB, 'student')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('switching voice on', () => {
  it('is off by default; only assistant administrators change the settings', async () => {
    expect(await rpc(user(U.student), `public.voice_status('uni-a', 'student_chat')`)).toEqual({ available: false, input: false, output: false, provider: 'browser', within_budget: false })
    await expect(record(user(U.student), 'input', 'browser', 5, 0)).rejects.toMatchObject({ code: '42501' })
    for (const actor of [U.staff, U.student, U.ownerB]) await expect(settings(user(actor))).rejects.toMatchObject({ code: '42501' })
    await expect(settings(user(U.owner), { provider: 'cloud' })).rejects.toMatchObject({ code: '23514' })
    await expect(settings(user(U.owner), { inPrice: -1 })).rejects.toMatchObject({ code: '23514' })
    await settings(user(U.owner))
    expect(await rpc(user(U.student), `public.voice_status('uni-a', 'student_chat')`)).toEqual({ available: true, input: true, output: true, provider: 'browser', within_budget: true })
  })

  it('each chat keeps its own permission', async () => {
    expect((await rpc(user(U.student), `public.voice_status('uni-a', 'staff_chat')`)).available).toBe(false)
    expect((await rpc(user(U.staff), `public.voice_status('uni-a', 'staff_chat')`)).available).toBe(true)
    await expect(record(user(U.student), 'output', 'browser', 0, 100, 'staff_chat')).rejects.toMatchObject({ code: '42501' })
    await expect(rpc(user(U.studentB), `public.voice_status('uni-a', 'student_chat')`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.voice_status('uni-a', 'student_chat')`)).rejects.toMatchObject({ code: '42501' })
    await settings(user(U.owner), { input: false })
    expect(await rpc(user(U.student), `public.voice_status('uni-a', 'student_chat')`)).toMatchObject({ input: false, output: true })
    await settings(user(U.owner))
  })
})

describe('usage is booked separately, priced by the university', () => {
  it('the browser costs nothing; the provider must match the settings; values are bounded', async () => {
    await record(user(U.student), 'input', 'browser', 12.5, 0)
    await record(user(U.student), 'output', 'browser', 0, 340)
    await expect(record(user(U.student), 'input', 'server', 10, 0)).rejects.toMatchObject({ code: '22023' })
    await expect(record(user(U.student), 'shout', 'browser', 10, 0)).rejects.toMatchObject({ code: '22023' })
    await expect(record(user(U.student), 'input', 'browser', 601, 0)).rejects.toMatchObject({ code: '23514' })
    expect(await costs()).toEqual([
      { kind: 'input', provider: 'browser', seconds: 12.5, characters: 0, cost_usd: 0 },
      { kind: 'output', provider: 'browser', seconds: 0, characters: 340, cost_usd: 0 },
    ])
    await expect(rpc(user(U.student), `public.voice_begin('uni-a', 'student_chat', 'input')`)).rejects.toMatchObject({ code: '22023' }) // browser: no server calls
  })

  it('a server provider is priced with the entered prices, or left unpriced', async () => {
    await settings(user(U.owner), { provider: 'server', inPrice: 0.006, outPrice: 0.015, budget: 1, daily: 120 })
    expect(await rpc(user(U.student), `public.voice_begin('uni-a', 'student_chat', 'input')`)).toEqual({ provider: 'server' })
    await record(user(U.student), 'input', 'server', 60, 0)
    await record(user(U.student), 'output', 'server', 0, 1500, 'student_chat')
    const rows = (await costs()).slice(2)
    expect(rows).toEqual([
      { kind: 'input', provider: 'server', seconds: 60, characters: 0, cost_usd: 0.006 },
      { kind: 'output', provider: 'server', seconds: 0, characters: 1500, cost_usd: 0.0225 },
    ])
    await settings(user(U.owner), { provider: 'server', inPrice: null, outPrice: 0.015, budget: 1, daily: 120 })
    await record(user(U.student2), 'input', 'server', 30, 0)
    expect((await costs()).at(-1)!.cost_usd).toBeNull()
    expect(await rpc(user(U.owner), `public.voice_usage('uni-a')`)).toMatchObject({ input_minutes: 1.7, input_uses: 3, output_characters: 1840, output_uses: 2, people: 2, unpriced: 1 })
  })

  it('the server provider has a daily limit per person, a monthly budget and per-kind switches', async () => {
    await record(user(U.student), 'input', 'server', 60, 0) // 120 s today on the server provider
    await expect(rpc(user(U.student), `public.voice_begin('uni-a', 'student_chat', 'input')`)).rejects.toMatchObject({ code: '54000' })
    expect(await rpc(user(U.student2), `public.voice_begin('uni-a', 'student_chat', 'input')`)).toEqual({ provider: 'server' })
    expect(await rpc(user(U.student), `public.voice_begin('uni-a', 'student_chat', 'output')`)).toEqual({ provider: 'server' }) // the limit is for speech input
    await settings(user(U.owner), { provider: 'server', inPrice: 0.006, outPrice: 0.015, budget: 0.01, daily: 600 })
    await expect(rpc(user(U.student2), `public.voice_begin('uni-a', 'student_chat', 'output')`)).rejects.toMatchObject({ code: '53400' })
    expect((await rpc(user(U.student2), `public.voice_status('uni-a', 'student_chat')`)).within_budget).toBe(false)
    await settings(user(U.owner), { provider: 'server', output: false, budget: 5 })
    await expect(rpc(user(U.student2), `public.voice_begin('uni-a', 'student_chat', 'output')`)).rejects.toMatchObject({ code: '55000' })
  })

  it('usage rows are never selectable; figures need assistant.configure; settings are audited', async () => {
    for (const actor of [U.owner, U.student]) await expect(query(pool, user(actor), `select * from public.voice_usage_events`)).rejects.toMatchObject({ code: '42501' })
    await expect(rpc(user(U.staff), `public.voice_usage('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    expect((await query(pool, user(U.student), `select count(*)::int as n from public.voice_settings`)).rows[0].n).toBe(0)
    const actions = (await pool.query(`select distinct action from public.audit_logs where action like 'voice_%' order by action`)).rows.map((r) => r.action)
    expect(actions).toEqual(['voice_settings.insert', 'voice_settings.update'])
  })

  it('analytics shows voice use, with costs only for people who may see costs', async () => {
    const a = await rpc(user(U.owner), `public.analytics_overview('uni-a', 7)`)
    expect(a.voice).toMatchObject({ input_minutes: 2.7, output_characters: 1840, people: 2 })
    expect(Number(a.voice.cost_usd)).toBeCloseTo(0.0285, 4) // 0.006 + 0.0225; the input recorded while no price was entered stays unpriced
    expect(Number(a.voice.budget_usd)).toBe(5)
  })

  it('without the feature nothing is possible', async () => {
    await pool.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'voice'`, [tenantA])
    expect((await rpc(user(U.student), `public.voice_status('uni-a', 'student_chat')`)).available).toBe(false)
    await expect(record(user(U.student), 'output', 'server', 0, 10)).rejects.toMatchObject({ code: '42501' })
    await expect(settings(user(U.owner))).rejects.toMatchObject({ code: '42501' })
    expect((await rpc(user(U.owner), `public.analytics_overview('uni-a', 7)`)).voice).toBeNull()
    await pool.query(`update public.tenant_features set enabled = true where tenant_id = $1 and feature_key = 'voice'`, [tenantA])
  })
})
