import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 15 (plans and subscriptions) database tests: plans only for platform billing staff;
 * assigning a plan sets the features and the university's status; limits enforced by the
 * database (members, invitations, documents, the monthly AI cap in every AI gate); the status
 * sweep (trial over, past due, grace, cancelled); manual payments that renew; the university's
 * own view (even while suspended; payments only for managers); the usage report.
 */

const U = {
  platformOwner: '95000000-0000-4000-8000-0000000000f1',
  billing: '95000000-0000-4000-8000-0000000000f2',
  support: '95000000-0000-4000-8000-0000000000f3',
  owner: '95000000-0000-4000-8000-00000000000a',
  staff: '95000000-0000-4000-8000-0000000000a1',
  student: '95000000-0000-4000-8000-0000000000a2',
  extra: '95000000-0000-4000-8000-0000000000a3',
  ownerB: '95000000-0000-4000-8000-00000000000b',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(`select ${sql} as r`, params)).then((r) => r.rows[0].r)

type Plan = { key?: string; features?: string[]; members?: number | null; documents?: number | null; ai?: number | null; trial?: number; grace?: number; currency?: string | null; price?: number | null; id?: string | null }
const savePlan = (actor: Actor, p: Plan = {}) =>
  run(actor, `public.platform_plan_save($1, $2, $3, null, null, true, $4, $5, 'year', $6, $7, $8, $9, $10, $11)`, [
    p.id ?? null,
    p.key ?? 'standard',
    'Standard',
    p.currency === undefined ? 'USD' : p.currency,
    p.price === undefined ? 1200000 : p.price,
    p.trial ?? 30,
    p.grace ?? 14,
    p.members === undefined ? null : p.members,
    p.documents === undefined ? null : p.documents,
    p.ai === undefined ? null : p.ai,
    p.features ?? ['knowledge_base', 'student_assistant', 'ticketing'],
  ])

async function addMember(tenant: string, userId: string, roleKey: string, status = 'active') {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id, status) values ($1, $2, $3) returning id`, [tenant, userId, status])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
  return rows[0]!.id
}
const tenantStatus = async (id: string) => (await pool.query(`select status from public.tenants where id = $1`, [id])).rows[0].status
const sub = async (id: string) => (await pool.query(`select status, period_end, trial_ends_at from public.tenant_subscriptions where tenant_id = $1`, [id])).rows[0]
const sweep = () => run(user(U.billing), `public.subscription_sweep()`)

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  await pool.query(`insert into public.platform_admins (user_id, role) values ($1, 'owner'), ($2, 'billing'), ($3, 'support')`, [U.platformOwner, U.billing, U.support])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  await addMember(tenantA, U.staff, 'registrar')
  await addMember(tenantA, U.student, 'student')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('plans', () => {
  it('only platform billing staff manage plans; values are checked', async () => {
    for (const actor of [U.support, U.owner, U.staff]) await expect(savePlan(user(actor))).rejects.toMatchObject({ code: '42501' })
    await expect(savePlan(user(U.billing), { key: 'Bad Key' })).rejects.toMatchObject({ code: '23514' })
    await expect(savePlan(user(U.billing), { currency: 'USD', price: null })).rejects.toMatchObject({ code: '23514' })
    await expect(savePlan(user(U.billing), { features: ['teleportation'] })).rejects.toMatchObject({ code: '22023' })
    await savePlan(user(U.billing), { key: 'by-quote', currency: null, price: null, trial: 0 })
    const id = await savePlan(user(U.billing))
    await savePlan(user(U.platformOwner), { id, features: ['knowledge_base', 'ticketing', 'student_assistant', 'analytics_basic'] })
    const plans = await rpc(user(U.billing), `public.platform_plans()`)
    expect(plans.map((p: { key: string }) => p.key).sort()).toEqual(['by-quote', 'standard'])
    expect(plans.find((p: { key: string }) => p.key === 'standard')).toMatchObject({ features: ['analytics_basic', 'knowledge_base', 'student_assistant', 'ticketing'], subscribers: 0, price_minor: 1200000 })
    expect((await query(pool, user(U.owner), `select count(*)::int as n from public.plans`)).rows[0].n).toBe(0)
    await expect(rpc(user(U.support), `public.platform_plans()`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('subscriptions', () => {
  it('assigning a plan sets the features and the status; the university sees its plan', async () => {
    await expect(run(user(U.owner), `public.platform_assign_plan('uni-a', 'standard', true, null)`)).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.billing), `public.platform_assign_plan('uni-a', 'by-quote', true, null)`)).rejects.toMatchObject({ code: '22023' }) // no trial on this plan
    await expect(run(user(U.billing), `public.platform_assign_plan('uni-a', 'standard', false, 0)`)).rejects.toMatchObject({ code: '22023' })
    await run(user(U.billing), `public.platform_assign_plan('uni-a', 'standard', true, null, 'pilot')`)
    expect(await tenantStatus(tenantA)).toBe('trial')
    const features = (await pool.query(`select feature_key from public.tenant_features where tenant_id = $1 and enabled order by 1`, [tenantA])).rows.map((r) => r.feature_key)
    expect(features).toEqual(['analytics_basic', 'knowledge_base', 'student_assistant', 'ticketing'])
    const mine = await rpc(user(U.owner), `public.tenant_subscription('uni-a')`)
    expect(mine.subscription).toMatchObject({ plan_name: 'Standard', status: 'trial', period_end: null })
    expect(mine.usage).toMatchObject({ members: 3, documents: 0 })
    expect(mine.payments).toEqual([])
    expect((await rpc(user(U.staff), `public.tenant_subscription('uni-a')`)).payments).toBeNull() // read, not manage
    for (const actor of [U.student, U.ownerB]) await expect(rpc(user(actor), `public.tenant_subscription('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    expect((await rpc(user(U.ownerB), `public.tenant_subscription('uni-b')`)).subscription).toBeNull() // no plan yet: no limits
  })

  it('members and invitations stop at the limit; overrides replace the plan', async () => {
    await run(user(U.billing), `public.platform_set_limits('uni-a', 3, null, null, 'three seats')`)
    await expect(run(user(U.owner), `public.create_invitation('uni-a', 'new@test.example', 'student', 7)`)).rejects.toMatchObject({ code: '54000' })
    await expect(addMember(tenantA, U.extra, 'student')).rejects.toMatchObject({ code: '54000' })
    const invited = await addMember(tenantA, U.extra, 'student', 'invited') // not active: allowed
    await expect(pool.query(`update public.tenant_memberships set status = 'active' where id = $1`, [invited])).rejects.toMatchObject({ code: '54000' })
    await run(user(U.billing), `public.platform_set_limits('uni-a', 4, 1, null, null)`)
    await pool.query(`update public.tenant_memberships set status = 'active' where id = $1`, [invited])
    await pool.query(`insert into public.knowledge_documents (tenant_id, title) values ($1, 'Fees policy')`, [tenantA])
    await expect(pool.query(`insert into public.knowledge_documents (tenant_id, title) values ($1, 'Second')`, [tenantA])).rejects.toMatchObject({ code: '54000' })
    await pool.query(`insert into public.knowledge_documents (tenant_id, title) values ($1, 'Unlimited elsewhere')`, [tenantB])
    expect((await rpc(user(U.owner), `public.tenant_subscription('uni-a')`)).limits).toEqual({ members: 4, documents: 1, ai_monthly_usd: null })
    await expect(run(user(U.owner), `public.platform_set_limits('uni-a', 100, null, null, null)`)).rejects.toMatchObject({ code: '42501' })
  })

  it('the monthly AI cap covers all AI features and is checked in every AI gate', async () => {
    await run(user(U.billing), `public.platform_set_limits('uni-a', 4, 1, 1.00, null)`)
    await pool.query(`select app.plan_ai_check($1)`, [tenantA])
    await pool.query(`insert into public.ai_usage_events (tenant_id, feature, model, cost_usd) values ($1, 'student_assistant', 'claude-test', 0.6), ($1, 'staff_assistant', 'claude-test', 0.5)`, [tenantA])
    await expect(pool.query(`select app.plan_ai_check($1)`, [tenantA])).rejects.toMatchObject({ code: '53400' })
    await pool.query(`select app.plan_ai_check($1)`, [tenantB]) // no plan: no cap
    const gates = ['public.assistant_begin_turn', 'public.admissions_begin_turn', 'public.tickets_ai_begin', 'public.academic_begin_generation', 'app.staff_gate', 'public.workflow_ai_begin', 'public.campus_ai_begin']
    for (const g of gates) {
      const { rows } = await pool.query(`select pg_get_functiondef(p.oid) as d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = $1`, [g])
      expect(rows, g).toHaveLength(1)
      expect(rows[0].d, g).toContain('app.plan_ai_check(')
    }
    await run(user(U.billing), `public.platform_set_limits('uni-a', 4, 1, null, null)`)
  })

  it('the next status follows the dates and the grace period', async () => {
    const next = async (status: string, trialEnds: string | null, periodEnd: string | null, grace = 14) =>
      (await pool.query(`select app.subscription_next_status($1, $2::timestamptz, $3::timestamptz, $4, '2026-06-30T12:00:00Z') as s`, [status, trialEnds, periodEnd, grace])).rows[0].s
    expect(await next('trial', '2026-07-01', null)).toBe('trial')
    expect(await next('trial', '2026-06-29', null)).toBe('expired')
    expect(await next('active', null, '2026-07-01')).toBe('active')
    expect(await next('active', null, '2026-06-25')).toBe('past_due')
    expect(await next('active', null, '2026-06-01')).toBe('suspended') // past the grace period too
    expect(await next('past_due', null, '2026-06-20')).toBe('past_due')
    expect(await next('past_due', null, '2026-06-10')).toBe('suspended')
    expect(await next('past_due', null, '2026-06-29', 0)).toBe('suspended')
    expect(await next('cancelled', null, '2026-07-01')).toBe('cancelled')
    expect(await next('cancelled', null, '2026-06-29')).toBe('expired')
    expect(await next('suspended', null, '2026-06-01')).toBe('suspended')
  })

  it('the sweep ends a trial and suspends; the university still sees why; a payment renews', async () => {
    await expect(run(user(U.owner), `public.subscription_sweep()`)).rejects.toMatchObject({ code: '42501' })
    expect(await sweep()).toEqual({ changed: 0 })
    await pool.query(`update public.tenant_subscriptions set trial_ends_at = now() - interval '1 hour' where tenant_id = $1`, [tenantA])
    expect(await sweep()).toEqual({ changed: 1 })
    expect((await sub(tenantA)).status).toBe('expired')
    expect(await tenantStatus(tenantA)).toBe('suspended')
    expect(await rpc(user(U.owner), `public.my_tenant_access('uni-a')`)).toMatchObject({ permissions: [] })
    expect((await rpc(user(U.owner), `public.tenant_subscription('uni-a')`)).subscription.status).toBe('expired')

    await expect(run(user(U.owner), `public.platform_record_payment('uni-a', 1200000, 'USD', 'bank_transfer', 'TRX-1', current_date, 12)`)).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.billing), `public.platform_record_payment('uni-a', 0, 'USD', 'bank_transfer', null, current_date, 12)`)).rejects.toMatchObject({ code: '23514' })
    await expect(run(user(U.billing), `public.platform_record_payment('uni-a', 100, 'USD', 'crypto', null, current_date, 12)`)).rejects.toMatchObject({ code: '23514' })
    await expect(run(user(U.billing), `public.platform_record_payment('uni-b', 100, 'USD', 'cash', null, current_date, 12)`)).rejects.toMatchObject({ code: 'P0002' }) // nothing to renew
    await run(user(U.billing), `public.platform_record_payment('uni-a', 1200000, 'usd', 'bank_transfer', 'TRX-1', current_date, 12, 'first year')`)
    const s = await sub(tenantA)
    expect(s.status).toBe('active')
    expect(s.trial_ends_at).toBeNull()
    expect(Math.round((new Date(s.period_end).getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(364)
    expect(await tenantStatus(tenantA)).toBe('active')
    expect((await rpc(user(U.owner), `public.tenant_subscription('uni-a')`)).payments).toMatchObject([{ amount_minor: 1200000, currency: 'USD', method: 'bank_transfer', reference: 'TRX-1', extends_months: 12 }])
  })

  it('past due, then suspended after the grace period; manual suspend, reactivate and cancel', async () => {
    await pool.query(`update public.tenant_subscriptions set period_end = now() - interval '2 days' where tenant_id = $1`, [tenantA])
    await sweep()
    expect((await sub(tenantA)).status).toBe('past_due')
    expect(await tenantStatus(tenantA)).toBe('active') // still working during the grace period
    await pool.query(`update public.tenant_subscriptions set period_end = now() - interval '20 days' where tenant_id = $1`, [tenantA])
    await sweep()
    expect((await sub(tenantA)).status).toBe('suspended')
    expect(await tenantStatus(tenantA)).toBe('suspended')

    await expect(run(user(U.billing), `public.platform_set_subscription_status('uni-a', 'expired')`)).rejects.toMatchObject({ code: '22023' })
    await expect(run(user(U.billing), `public.platform_set_subscription_status('uni-b', 'active')`)).rejects.toMatchObject({ code: 'P0002' })
    await pool.query(`update public.tenant_subscriptions set period_end = now() + interval '30 days' where tenant_id = $1`, [tenantA])
    await run(user(U.billing), `public.platform_set_subscription_status('uni-a', 'active', 'agreed extension')`)
    expect(await tenantStatus(tenantA)).toBe('active')
    await run(user(U.billing), `public.platform_set_subscription_status('uni-a', 'cancelled')`)
    expect(await tenantStatus(tenantA)).toBe('active') // until the end of the paid period
    await sweep()
    expect((await sub(tenantA)).status).toBe('cancelled')
    await pool.query(`update public.tenant_subscriptions set period_end = now() - interval '1 minute' where tenant_id = $1`, [tenantA])
    await sweep()
    expect((await sub(tenantA)).status).toBe('expired')
    expect(await tenantStatus(tenantA)).toBe('suspended')

    // Archived universities are never changed.
    await pool.query(`update public.tenants set status = 'archived' where id = $1`, [tenantA])
    await expect(run(user(U.billing), `public.platform_assign_plan('uni-a', 'standard', false, 12)`)).rejects.toMatchObject({ code: '55000' })
    await pool.query(`update public.tenants set status = 'suspended' where id = $1`, [tenantA])
  })

  it('history, audit, and a plan in use cannot be deleted', async () => {
    const d = await rpc(user(U.billing), `public.platform_subscription('uni-a')`)
    const kinds = d.events.map((e: { kind: string }) => e.kind)
    for (const k of ['plan_assigned', 'limits_changed', 'payment_recorded', 'renewed', 'status_changed']) expect(kinds).toContain(k)
    expect(d.events.find((e: { note: string | null }) => e.note === 'automatic')).toBeDefined()
    expect(d.payments[0]).not.toHaveProperty('recorded_by')
    expect(await rpc(user(U.support), `public.platform_subscription('uni-a')`).catch((e) => e.code)).toBe('42501')
    const plan = (await pool.query(`select id from public.plans where key = 'standard'`)).rows[0].id
    await expect(run(user(U.billing), `public.platform_plan_delete($1)`, [plan])).rejects.toMatchObject({ code: '23503' })
    const actions = (await pool.query(`select distinct action from public.audit_logs where action like any (array['plans.%', 'plan_features.%', 'tenant_subscriptions.%', 'payment_records.%']) order by action`)).rows.map((r) => r.action)
    // Changing only a plan's features is audited through plan_features (the plan row itself did not change).
    expect(actions).toEqual(['payment_records.insert', 'plan_features.insert', 'plans.insert', 'tenant_subscriptions.insert', 'tenant_subscriptions.update'])
    for (const actor of [U.owner, U.staff]) {
      expect((await query(pool, user(actor), `select count(*)::int as n from public.payment_records`)).rows[0].n).toBe(0)
      expect((await query(pool, user(actor), `select count(*)::int as n from public.tenant_subscriptions`)).rows[0].n).toBe(0)
    }
  })
})

describe('usage report', () => {
  it('counts and costs per university and month, for billing staff only', async () => {
    await pool.query(`insert into public.voice_usage_events (tenant_id, kind, provider, surface, seconds, cost_usd) values ($1, 'input', 'server', 'student_chat', 60, 0.006)`, [tenantA])
    const r = await rpc(user(U.billing), `public.platform_usage_report(current_date)`)
    expect(r.month).toMatch(/^\d{4}-\d{2}$/)
    const a = r.tenants.find((t: { slug: string }) => t.slug === 'uni-a')
    expect(a).toMatchObject({ plan: 'Standard', subscription_status: 'expired', members: 4, documents: 1, ai_calls: 2, conversations: 0, tickets: 0 })
    expect(Number(a.ai_cost_usd)).toBeCloseTo(1.1, 6)
    expect(Number(a.voice_cost_usd)).toBeCloseTo(0.006, 6)
    expect(a.paid).toEqual({ USD: 1200000 })
    expect(r.tenants.find((t: { slug: string }) => t.slug === 'uni-b')).toMatchObject({ plan: null, limits: null, documents: 1, ai_calls: 0 })
    expect(JSON.stringify(r)).not.toContain('@test.example')
    expect((await rpc(user(U.billing), `public.platform_usage_report('2020-01-15')`)).tenants[0]).toMatchObject({ ai_calls: 0 })
    for (const actor of [U.support, U.owner]) await expect(rpc(user(actor), `public.platform_usage_report(current_date)`)).rejects.toMatchObject({ code: '42501' })
  })
})
