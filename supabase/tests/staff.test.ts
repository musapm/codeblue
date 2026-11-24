import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 10 (staff assistant) database tests: who may use it and its gate (switch, budget, daily
 * limit); staff conversations kept apart from the student assistant; department-scoped retrieval
 * that never widens what a person may read; private drafts; the ticket digest limited to tickets
 * the person works (not their own requests, not other departments); usage and analytics.
 */

const U = {
  owner: '90000000-0000-4000-8000-00000000000a',
  registrar: '90000000-0000-4000-8000-0000000000a1', // Registry staff: tickets in Registry, no read_all
  finance: '90000000-0000-4000-8000-0000000000a2', // Finance staff
  faculty: '90000000-0000-4000-8000-0000000000a3', // assistant.staff.use, no ticket queues
  student: '90000000-0000-4000-8000-0000000000a4',
  ownerB: '90000000-0000-4000-8000-00000000000b',
  staffB: '90000000-0000-4000-8000-0000000000b1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
let registry: string
let financeDept: string
let deptB: string
const D: Record<string, string> = {}

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(`select ${sql} as r`, params)).then((r) => r.rows[0].r)
const count = async (actor: Actor, table: string, where = 'true', params: unknown[] = []) =>
  (await query(pool, actor, `select count(*)::int as n from ${table} where ${where}`, params)).rows[0].n as number

async function addMember(tenant: string, userId: string, roleKey: string, departmentId?: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
  if (departmentId) await pool.query(`insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`, [tenant, rows[0]!.id, departmentId])
}

async function doc(owner: string, slug: string, meta: Record<string, unknown>, content: string): Promise<string> {
  const begun = await run(user(owner), `public.knowledge_begin_upload($1, null, 'doc.pdf', 'application/pdf', 1000, $2)`, [slug, JSON.stringify(meta)])
  await asCommitted(pool, user(owner), async (c) => {
    await c.query(`select public.knowledge_set_version_status($1, 'queued', null, $2)`, [begun.version_id, 'c'.repeat(64)])
    await c.query(`select public.knowledge_set_version_status($1, 'processing')`, [begun.version_id])
    await c.query(`select public.knowledge_complete_version($1, '{"page_count":1}', $2)`, [begun.version_id, JSON.stringify([{ content, page_from: 1, page_to: 1 }])])
    await c.query(`select public.knowledge_set_published($1, true)`, [begun.document_id])
  })
  return begun.document_id
}

const titles = async (actor: Actor, q: string, department: string | null = null) =>
  ((await rpc(actor, `public.search_knowledge('uni-a', $1, 8, null, null, $2)`, [q, department])) as { title: string }[]).map((h) => h.title).sort()

const settings = (actor: Actor, enabled: boolean, budget = 20, limit = 60) =>
  run(actor, `public.staff_assistant_update_settings('uni-a', $1, 'Be brief.', $2, $3)`, [enabled, budget, limit])

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  registry = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Registry', 'registry') returning id`, [tenantA])).rows[0].id
  financeDept = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Finance', 'finance') returning id`, [tenantA])).rows[0].id
  deptB = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Registry B', 'registry') returning id`, [tenantB])).rows[0].id
  await addMember(tenantA, U.registrar, 'registrar', registry)
  await addMember(tenantA, U.finance, 'finance_staff', financeDept)
  await addMember(tenantA, U.faculty, 'faculty')
  await addMember(tenantA, U.student, 'student')
  await addMember(tenantB, U.staffB, 'registrar', deptB)

  D.registry = await doc(U.owner, 'uni-a', { title: 'Registry procedures', visibility: 'staff', department_id: registry }, 'Transcript procedures: requests are processed in five working days.')
  D.refunds = await doc(U.owner, 'uni-a', { title: 'Finance refunds', visibility: 'restricted', department_id: financeDept, access_department_ids: [financeDept] }, 'Refund procedures for tuition fees.')
  D.handbook = await doc(U.owner, 'uni-a', { title: 'Student handbook', visibility: 'members' }, 'General procedures for students.')
  await doc(U.ownerB, 'uni-b', { title: 'Registry procedures B', visibility: 'staff', department_id: deptB }, 'Transcript procedures at University B.')

  // Open and closed tickets with known queues.
  const ticket = (ref: string, f: { department: string; status: string; requester?: string; assignee?: string | null; priority?: string }) =>
    pool.query(
      `insert into public.tickets (tenant_id, reference, subject, department_id, status, priority, source, requester_id, requester_name, assignee_id, created_at, last_activity_at)
       values ($1, $2, $3, $4, $5, $6, 'portal', $7, 'Sara Student', $8, now() - interval '2 days', now() - interval '1 day') returning id`,
      [tenantA, ref, `Subject ${ref}`, f.department, f.status, f.priority ?? 'normal', f.requester ?? U.student, f.assignee ?? null],
    ).then((r) => r.rows[0].id as string)
  const t1 = await ticket('T-00001', { department: registry, status: 'open', assignee: U.registrar, priority: 'high' })
  await ticket('T-00002', { department: registry, status: 'in_progress', priority: 'urgent' })
  await ticket('T-00003', { department: financeDept, status: 'open' })
  await ticket('T-00004', { department: registry, status: 'closed' })
  await ticket('T-00005', { department: registry, status: 'open', requester: U.registrar }) // the registrar's own request
  await pool.query(`insert into public.ticket_messages (tenant_id, ticket_id, author_id, author_name, from_staff, body) values ($1, $2, $3, 'Sara Student', false, 'Please send my transcript to sara@example.com')`, [tenantA, t1, U.student])
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('who may use the staff assistant', () => {
  const begin = (actor: string, q = 'How are transcripts processed?', conversation: string | null = null) =>
    run(user(actor), `public.staff_begin_turn('uni-a', $1, $2)`, [conversation, q])

  it('off until an assistant administrator turns it on; only they change the settings', async () => {
    await expect(begin(U.registrar)).rejects.toMatchObject({ code: '55000' })
    for (const actor of [U.registrar, U.student, U.ownerB]) await expect(settings(user(actor), true)).rejects.toMatchObject({ code: '42501' })
    await settings(user(U.owner), true)
    expect(await rpc(user(U.registrar), `public.staff_assistant_status('uni-a')`)).toEqual({ can_use: true, feature: true, enabled: true, within_budget: true, can_digest: true })
    expect(await rpc(user(U.faculty), `public.staff_assistant_status('uni-a')`)).toMatchObject({ can_use: true, can_digest: false })
    expect(await rpc(user(U.student), `public.staff_assistant_status('uni-a')`)).toMatchObject({ can_use: false })
  })

  it('staff only: not students, other universities or anonymous callers', async () => {
    await expect(begin(U.student)).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.staffB), `public.staff_begin_turn('uni-a', null, 'Hello there')`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.staff_begin_turn('uni-a', null, 'Hello there')`)).rejects.toMatchObject({ code: '42501' })
    await pool.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'staff_assistant'`, [tenantA])
    await expect(begin(U.registrar)).rejects.toMatchObject({ code: '42501' })
    await pool.query(`update public.tenant_features set enabled = true where tenant_id = $1 and feature_key = 'staff_assistant'`, [tenantA])
  })

  it('its own monthly budget and a daily limit per person', async () => {
    await settings(user(U.owner), true, 0)
    await expect(begin(U.registrar)).rejects.toMatchObject({ code: '53400' })
    await settings(user(U.owner), true, 20, 1)
    await pool.query(`insert into public.ai_usage_events (tenant_id, user_id, feature, model, cost_usd) values ($1, $2, 'staff_assistant', 'claude-opus-5-5', 0.01)`, [tenantA, U.finance])
    await expect(begin(U.finance)).rejects.toMatchObject({ code: '54000' })
    expect((await begin(U.registrar)).conversation_id).toBeTruthy() // another person still can
    await settings(user(U.owner), true, 20, 60)
  })
})

describe('staff conversations stay apart', () => {
  let staffConversation: string
  let studentConversation: string

  it('are private and cannot be continued by the student assistant (or the other way round)', async () => {
    const r = await run(user(U.registrar), `public.staff_begin_turn('uni-a', null, 'How are transcripts processed?')`)
    staffConversation = r.conversation_id
    expect(r.instructions).toBe('Be brief.')
    expect((await pool.query(`select agent from public.assistant_conversations where id = $1`, [staffConversation])).rows[0].agent).toBe('staff')
    await run(user(U.owner), `public.assistant_update_settings('uni-a', true, null, 10)`)
    await expect(run(user(U.registrar), `public.assistant_begin_turn('uni-a', $1, 'Continue here')`, [staffConversation])).rejects.toMatchObject({ code: 'P0002' })
    studentConversation = (await run(user(U.registrar), `public.assistant_begin_turn('uni-a', null, 'A student question')`)).conversation_id
    await expect(run(user(U.registrar), `public.staff_begin_turn('uni-a', $1, 'Continue here')`, [studentConversation])).rejects.toMatchObject({ code: 'P0002' })
    expect(await count(user(U.finance), 'public.assistant_conversations', 'id = $1', [staffConversation])).toBe(0)
    expect(await count(user(U.owner), 'public.assistant_conversations', 'id = $1', [staffConversation])).toBe(0)
  })

  it('answers book usage to the staff assistant', async () => {
    await run(user(U.registrar), `public.assistant_complete_turn($1, 'Five working days.', 'answered', '[]', '[]', 'claude-opus-5-5', $2, 900)`, [
      staffConversation,
      JSON.stringify({ input_tokens: 1000, output_tokens: 100, cost_usd: 0.02 }),
    ])
    const feature = (await pool.query(`select feature from public.ai_usage_events where user_id = $1 order by created_at desc limit 1`, [U.registrar])).rows[0].feature
    expect(feature).toBe('staff_assistant')
  })

  it('staff conversations are not part of the AI quality review', async () => {
    await run(user(U.registrar), `public.assistant_complete_turn($1, 'Not found.', 'no_sources', '[]', '[]', null, null, 100)`, [staffConversation])
    const gaps = await rpc(user(U.owner), `public.quality_gaps('uni-a', 7, null, 'all', 50)`)
    expect(gaps).toEqual([])
  })
})

describe('department-scoped search never widens access', () => {
  it('without a department: everything the person may read', async () => {
    expect(await titles(user(U.registrar), 'procedures')).toEqual(['Registry procedures', 'Student handbook'])
    expect(await titles(user(U.finance), 'procedures')).toEqual(['Finance refunds', 'Registry procedures', 'Student handbook'])
  })

  it('with a department: only that department’s documents among those', async () => {
    expect(await titles(user(U.finance), 'procedures', registry)).toEqual(['Registry procedures'])
    expect(await titles(user(U.finance), 'procedures', financeDept)).toEqual(['Finance refunds'])
    expect(await titles(user(U.registrar), 'procedures', financeDept)).toEqual([]) // restricted to Finance
    expect(await titles(user(U.registrar), 'procedures', deptB)).toEqual([]) // another university
    expect(await titles(user(U.student), 'procedures', registry)).toEqual([]) // staff-only document
  })

  it('the old call shape still works (Phase 4 callers)', async () => {
    const hits = (await rpc(user(U.registrar), `public.search_knowledge('uni-a', 'transcript', 8)`)) as { title: string }[]
    expect(hits.map((h) => h.title)).toEqual(['Registry procedures'])
  })
})

describe('drafts are private to their author', () => {
  const draft = (actor: string, kind = 'email', content: unknown = { subject: 'Transcripts', body: 'Dear students, …', missing: ['date'] }, sources: unknown[] = []) =>
    run(user(actor), `public.staff_save_draft('uni-a', $1, 'Transcripts email', 'en', $2, $3, 'claude-opus-5-5', $4)`, [
      kind,
      JSON.stringify(content),
      JSON.stringify(sources),
      JSON.stringify({ input_tokens: 500, output_tokens: 300, cost_usd: 0.01 }),
    ])

  it('staff save drafts; nobody else sees them; only the author deletes', async () => {
    expect(await rpc(user(U.registrar), `public.staff_ai_begin('uni-a', 'draft')`)).toEqual({ instructions: 'Be brief.' })
    await expect(rpc(user(U.student), `public.staff_ai_begin('uni-a', 'draft')`)).rejects.toMatchObject({ code: '42501' })
    const id = await draft(U.registrar)
    expect(await count(user(U.registrar), 'public.staff_drafts')).toBe(1)
    for (const actor of [U.finance, U.owner, U.ownerB, U.student]) expect(await count(user(actor), 'public.staff_drafts')).toBe(0)
    await expect(run(user(U.finance), `public.staff_delete_draft($1)`, [id])).rejects.toMatchObject({ code: 'P0002' })
    await run(user(U.registrar), `public.staff_delete_draft($1)`, [id])
    expect(await count(user(U.registrar), 'public.staff_drafts')).toBe(0)
  })

  it('malformed drafts are refused; students cannot save drafts', async () => {
    await expect(draft(U.registrar, 'memo')).rejects.toMatchObject({ code: '23514' })
    await expect(draft(U.registrar, 'email', { subject: 'No body' })).rejects.toMatchObject({ code: '23514' })
    await expect(draft(U.registrar, 'email', undefined, Array.from({ length: 11 }, () => ({})))).rejects.toMatchObject({ code: '22023' })
    await expect(draft(U.student)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('the ticket digest covers only tickets the person works', () => {
  const refs = async (actor: string, scope: string, department: string | null = null) =>
    ((await rpc(user(actor), `public.staff_ticket_digest_source('uni-a', $1, $2)`, [scope, department])).tickets as { reference: string }[]).map((t) => t.reference)

  it('my departments, open only, most urgent first; never my own requests or other departments', async () => {
    expect(await refs(U.registrar, 'department')).toEqual(['T-00002', 'T-00001'])
    expect(await refs(U.registrar, 'mine')).toEqual(['T-00001'])
    expect(await refs(U.registrar, 'department', financeDept)).toEqual([])
    expect(await refs(U.finance, 'department')).toEqual(['T-00003'])
    expect(await refs(U.owner, 'all')).toEqual(['T-00002', 'T-00001', 'T-00003', 'T-00005'])
  })

  it('minimal fields: no requester names or ids, no internal notes', async () => {
    const r = await rpc(user(U.registrar), `public.staff_ticket_digest_source('uni-a', 'mine', null)`)
    expect(r.total).toBe(1)
    const t = r.tickets[0]
    expect(Object.keys(t).sort()).toEqual(['assigned', 'assigned_to_me', 'category', 'created_at', 'department', 'first_message', 'id', 'last_activity_at', 'last_message', 'priority', 'reference', 'status', 'subject'])
    expect(JSON.stringify(r)).not.toContain('Sara Student')
    expect(JSON.stringify(r)).not.toContain(U.student)
    expect(t.first_message).toBe('Please send my transcript to sara@example.com')
  })

  it('needs ticket queues; "all" needs tickets.read_all', async () => {
    await expect(rpc(user(U.registrar), `public.staff_ticket_digest_source('uni-a', 'all', null)`)).rejects.toMatchObject({ code: '22023' })
    for (const actor of [U.faculty, U.student, U.staffB]) await expect(rpc(user(actor), `public.staff_ticket_digest_source('uni-a', 'department', null)`)).rejects.toMatchObject({ code: '42501' })
    await expect(rpc(user(U.faculty), `public.staff_ai_begin('uni-a', 'digest')`)).rejects.toMatchObject({ code: '42501' })
    await expect(rpc(user(U.registrar), `public.staff_ticket_digest_source('uni-a', 'mine', $1)`, [registry])).rejects.toMatchObject({ code: '22023' })
  })
})

describe('usage and analytics', () => {
  it('month figures for administrators; analytics counts staff questions, cost and budget', async () => {
    const usage = await rpc(user(U.owner), `public.staff_assistant_usage('uni-a')`)
    expect(usage).toMatchObject({ questions: 2, drafts: 0 })
    expect(Number(usage.cost_usd)).toBeGreaterThan(0)
    await expect(rpc(user(U.registrar), `public.staff_assistant_usage('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    const a = await rpc(user(U.owner), `public.analytics_overview('uni-a', 7)`)
    expect(a.assistant.staff).toMatchObject({ questions: 2, answered: 1, no_sources: 1 })
    expect(a.ai.month.staff_assistant).toBeGreaterThan(0)
    expect(a.ai.budgets.staff_assistant).toBe(20)
  })

  it('settings are visible to assistant administrators only; settings are audited, drafts are not', async () => {
    expect(await count(user(U.owner), 'public.staff_assistant_settings')).toBe(1)
    for (const actor of [U.registrar, U.student, U.ownerB]) expect(await count(user(actor), 'public.staff_assistant_settings')).toBe(0)
    const actions = (await pool.query(`select distinct action from public.audit_logs where action like 'staff_%' order by action`)).rows.map((r) => r.action)
    expect(actions).toEqual(['staff_assistant_settings.insert', 'staff_assistant_settings.update'])
    const leaked = (await pool.query(`select count(*)::int as n from public.audit_logs where metadata::text ilike '%Dear students%'`)).rows[0].n
    expect(leaked).toBe(0)
  })
})
