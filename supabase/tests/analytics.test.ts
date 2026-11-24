import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 8 (admin dashboard, analytics, AI quality) database tests: who may see which numbers;
 * numbers computed only from stored rows, in the university's own days; knowledge gaps grouped
 * without the person and with contact details redacted; flagged answers hidden from reviewers
 * who could not read the documents behind them; reviews; and that nothing crosses universities.
 */

const U = {
  owner: '70000000-0000-4000-8000-00000000000a',
  reviewer: '70000000-0000-4000-8000-0000000000a1', // quality_reviewer: quality.review + analytics.view
  deptAdmin: '70000000-0000-4000-8000-0000000000a2', // department_admin (Registry): analytics.view + knowledge.manage
  registrar: '70000000-0000-4000-8000-0000000000a3', // staff, no analytics
  hr: '70000000-0000-4000-8000-0000000000a4', // HR staff, reads the restricted HR document
  s1: '70000000-0000-4000-8000-0000000000a5',
  s2: '70000000-0000-4000-8000-0000000000a6',
  visitor: '70000000-0000-4000-8000-0000000000a7',
  ownerB: '70000000-0000-4000-8000-00000000000b',
  studentB: '70000000-0000-4000-8000-0000000000b1',
  ownerC: '70000000-0000-4000-8000-00000000000c',
  studentC: '70000000-0000-4000-8000-0000000000c1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
let registry: string
let hrDept: string
const D: Record<string, string> = {}
const A: Record<string, string> = {} // assistant messages (answers) by name

const H = 3_600_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

async function addMember(tenant: string, userId: string, roleKey: string, departmentId?: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
  if (departmentId) await pool.query(`insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`, [tenant, rows[0]!.id, departmentId])
}

/** Upload, process and publish a document through the real knowledge functions (as the owner). */
async function doc(slug: string, meta: Record<string, unknown>, publish = true): Promise<string> {
  const begun = await asCommitted(pool, user(U.owner), (c) =>
    c.query(`select public.knowledge_begin_upload($1, null, 'doc.pdf', 'application/pdf', 1000, $2) as r`, [slug, JSON.stringify(meta)]),
  )
  const { document_id: id, version_id: version } = begun.rows[0].r
  await asCommitted(pool, user(U.owner), async (c) => {
    await c.query(`select public.knowledge_set_version_status($1, 'queued', null, $2)`, [version, 'a'.repeat(64)])
    await c.query(`select public.knowledge_set_version_status($1, 'processing')`, [version])
    await c.query(`select public.knowledge_complete_version($1, $2, $3)`, [version, JSON.stringify({ page_count: 1, char_count: 100 }), JSON.stringify([{ content: `${meta.title} content.` }])])
    if (publish) await c.query(`select public.knowledge_set_published($1, true)`, [id])
  })
  return id
}

async function conversation(tenant: string, userId: string, agent: 'student' | 'admissions' = 'student'): Promise<string> {
  return (await pool.query(`insert into public.assistant_conversations (tenant_id, user_id, title, agent) values ($1, $2, 'Conversation', $3) returning id`, [tenant, userId, agent])).rows[0].id
}

async function say(
  tenant: string,
  conv: string,
  role: 'user' | 'assistant',
  content: string,
  at: string,
  opts: { status?: string; citations?: unknown[]; sources?: unknown[]; latency?: number } = {},
): Promise<string> {
  return (
    await pool.query(
      `insert into public.assistant_messages (tenant_id, conversation_id, role, content, status, citations, sources, latency_ms, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [tenant, conv, role, content, opts.status ?? (role === 'user' ? 'question' : 'answered'), JSON.stringify(opts.citations ?? []), JSON.stringify(opts.sources ?? []), opts.latency ?? null, at],
    )
  ).rows[0].id
}

/** One exchange: the question, then the answer a second later. Returns the answer's id. */
async function exchange(tenant: string, conv: string, question: string, at: number, status: string, answer = 'Answer.', docs: string[] = [], latency?: number) {
  await say(tenant, conv, 'user', question, ago(at))
  const cites = docs.map((d, i) => ({ n: i + 1, chunk_id: i + 1, document_id: d, title: `Doc ${i + 1}`, page_from: 1, page_to: 1, cited_text: 'Quoted passage.' }))
  return say(tenant, conv, 'assistant', answer, ago(at - 1000), {
    status,
    citations: cites,
    sources: docs.map((d, i) => ({ chunk_id: i + 1, document_id: d, version_no: 1, score: 1 })),
    latency,
  })
}

const rate = (tenant: string, message: string, userId: string, rating: 1 | -1, at: string, comment: string | null = null) =>
  pool.query(`insert into public.assistant_feedback (message_id, tenant_id, user_id, rating, comment, created_at) values ($1, $2, $3, $4, $5, $6)`, [message, tenant, userId, rating, comment, at])

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const overview = (actor: Actor, days = 7, slug = 'uni-a') => rpc(actor, `public.analytics_overview($1, $2)`, [slug, days])
const gaps = (actor: Actor, opts: { days?: number; agent?: string | null; state?: string } = {}) =>
  rpc(actor, `public.quality_gaps('uni-a', $1, $2, $3, 50)`, [opts.days ?? 7, opts.agent ?? null, opts.state ?? 'open'])
const flagged = (actor: Actor, kind: string, opts: { days?: number; state?: string } = {}) =>
  rpc(actor, `public.quality_flagged('uni-a', $1, $2, null, $3, 50)`, [kind, opts.days ?? 7, opts.state ?? 'open'])
const save = (actor: Actor, ids: string[], outcome: string, note: string | null = null) =>
  asCommitted(pool, actor, (c) => c.query(`select public.quality_review_save('uni-a', $1::uuid[], $2, $3) as n`, [ids, outcome, note])).then((r) => r.rows[0].n as number)
const setFeature = (tenant: string, key: string, enabled: boolean) => pool.query(`update public.tenant_features set enabled = $3 where tenant_id = $1 and feature_key = $2`, [tenant, key, enabled])

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  await pool.query(`update public.profiles set full_name = 'Rania Reviewer' where id = $1`, [U.reviewer])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1, 'en', 'Asia/Riyadh') as id`, [U.owner])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  registry = (await pool.query(`insert into public.departments (tenant_id, name, slug, name_translations) values ($1, 'Registry', 'registry', '{"ar": "التسجيل"}') returning id`, [tenantA])).rows[0].id
  hrDept = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Human resources', 'hr') returning id`, [tenantA])).rows[0].id
  await addMember(tenantA, U.reviewer, 'quality_reviewer')
  await addMember(tenantA, U.deptAdmin, 'department_admin', registry)
  await addMember(tenantA, U.registrar, 'registrar', registry)
  await addMember(tenantA, U.hr, 'hr_staff', hrDept)
  await addMember(tenantA, U.s1, 'student')
  await addMember(tenantA, U.s2, 'student')
  await addMember(tenantB, U.studentB, 'student')
  await asCommitted(pool, user(U.owner), (c) => c.query(`select public.assistant_update_settings('uni-a', true, null, 25)`))

  // Knowledge: three published documents (one restricted to HR), one expired, one unpublished.
  D.guide = await doc('uni-a', { title: 'Registration guide', visibility: 'members' })
  D.staff = await doc('uni-a', { title: 'Staff fee procedures', visibility: 'staff' })
  D.hr = await doc('uni-a', { title: 'HR salary scale', visibility: 'restricted', access_department_ids: [hrDept] })
  D.old = await doc('uni-a', { title: 'Old calendar', visibility: 'members' })
  await pool.query(`update public.knowledge_documents set effective_date = null, expiry_date = (now() at time zone 'Asia/Riyadh')::date - 1 where id = $1`, [D.old])
  D.draft = await doc('uni-a', { title: 'Draft policy', visibility: 'members' }, false)

  // Student assistant in the last few hours.
  const c1 = await conversation(tenantA, U.s1)
  A.a1 = await exchange(tenantA, c1, 'When is registration?', 5 * H, 'answered', 'Registration opens on 1 December.', [D.guide], 1000)
  A.a2 = await exchange(tenantA, c1, 'when is registration', 4 * H, 'no_sources')
  A.a3 = await exchange(tenantA, c1, 'WHEN IS REGISTRATION ??', 3 * H, 'no_sources')
  const c2 = await conversation(tenantA, U.s2)
  A.a4 = await exchange(tenantA, c2, 'متى التسجيل؟', 4 * H, 'no_sources')
  A.a5 = await exchange(tenantA, c2, 'متي التسجيل', 2.5 * H, 'no_sources')
  A.a6 = await exchange(tenantA, c2, 'My student id is 441234567, email sara@uni.edu, phone +966 50 123 4567, see https://portal.uni.edu/x?token=abc on 2026-11-23', 2 * H, 'no_sources')
  A.a7 = await exchange(tenantA, c2, 'How do I cheat in the exam system?', 2 * H - 5000, 'refused', 'I can’t help with that.')
  A.a8 = await exchange(tenantA, c2, 'What are the fees?', 1 * H, 'answered', 'The fees are listed in the guide.', [D.guide, D.staff], 3000)
  const c3 = await conversation(tenantA, U.hr)
  A.a9 = await exchange(tenantA, c3, 'What is the HR salary scale?', 1 * H - 5000, 'answered', 'Grade 5 earns 9000. Questions: 011 234 5678.', [D.hr], 2000)
  const c4 = await conversation(tenantA, U.s1)
  await say(tenantA, c4, 'user', 'A question that never got an answer', ago(0.5 * H))
  A.a11 = await exchange(tenantA, c4, 'Is the library open?', 0.3 * H, 'error', 'Something went wrong.')
  await rate(tenantA, A.a1, U.s1, -1, ago(10 * 60_000), 'Wrong date, email me at sara@uni.edu')
  await rate(tenantA, A.a8, U.s2, 1, ago(10 * 60_000))
  await rate(tenantA, A.a9, U.hr, -1, ago(8 * 60_000), 'Outdated')

  // Forty days ago (outside 7 and 30 days, inside 90).
  const c6 = await conversation(tenantA, U.s1)
  A.old = await exchange(tenantA, c6, 'Old question', 40 * 24 * H, 'answered', 'Old answer.', [D.guide])
  await rate(tenantA, A.old, U.s1, -1, ago(40 * 24 * H))

  // Admissions assistant (a visitor).
  const c7 = await conversation(tenantA, U.visitor, 'admissions')
  A.a13 = await exchange(tenantA, c7, 'Do you offer nursing?', 1.5 * H, 'no_sources')
  const c8 = await conversation(tenantA, U.visitor, 'admissions')
  await say(tenantA, c8, 'user', 'Tell me about the MBA', ago(1 * H))
  A.a14 = await say(tenantA, c8, 'assistant', 'The MBA takes two years.', ago(1 * H - 1000), {
    citations: [{ n: 1, chunk_id: 0, document_id: '', title: 'MBA', page_from: null, page_to: null, cited_text: 'Two years.', program_id: 'p1', program_code: 'MBA' }],
    sources: [{ program_id: 'p1' }],
  })
  await rate(tenantA, A.a14, U.visitor, -1, ago(5 * 60_000))

  // Another university with the same question: never counted for University A.
  const cB = await conversation(tenantB, U.studentB)
  A.b1 = await exchange(tenantB, cB, 'When is registration?', 1 * H, 'no_sources')

  // Tickets with known times.
  const cat = (await pool.query(`insert into public.ticket_categories (tenant_id, name, department_id) values ($1, 'Transcripts', $2) returning id`, [tenantA, registry])).rows[0].id
  const ticket = (ref: string, f: Record<string, unknown>) =>
    pool.query(
      `insert into public.tickets (tenant_id, reference, subject, category_id, department_id, status, source, requester_id, requester_name, assignee_id, conversation_id, created_at, first_response_at, resolved_at, closed_at)
       values ($1, $2, 'A request', $3, $4, $5, $6, $7, 'Student', $8, $9, $10, $11, $12, $13)`,
      [tenantA, ref, f.category ?? null, f.department ?? null, f.status, f.source ?? 'portal', U.s1, f.assignee ?? null, f.conversation ?? null, f.created, f.response ?? null, f.resolved ?? null, f.closed ?? null],
    )
  await ticket('T-00001', { category: cat, department: registry, status: 'resolved', created: ago(10 * H), response: ago(9 * H), resolved: ago(6 * H) })
  await ticket('T-00002', { department: registry, status: 'in_progress', source: 'assistant', conversation: c1, assignee: U.registrar, created: ago(5 * H), response: ago(2 * H) })
  await ticket('T-00003', { department: hrDept, status: 'open', created: ago(2 * H) })
  await ticket('T-00004', { department: registry, status: 'open', created: ago(40 * 24 * H) })
  await ticket('T-00005', { category: cat, department: registry, status: 'closed', created: ago(3 * H), closed: ago(1 * H) })

  // Admissions inquiries and AI usage.
  const lead = (ref: string, source: string, at: string) =>
    pool.query(
      `insert into public.admission_leads (tenant_id, reference, full_name, email, source, consent_at, consent_version, consent_text, created_at)
       values ($1, $2, 'Applicant', 'a@example.com', $3, now(), 'default-1', 'I agree to be contacted.', $4)`,
      [tenantA, ref, source, at],
    )
  await lead('L-00001', 'form', ago(2 * H))
  await lead('L-00002', 'assistant', ago(1 * H))
  await lead('L-00003', 'form', ago(40 * 24 * H))
  await pool.query(
    `insert into public.ai_usage_events (tenant_id, user_id, feature, model, input_tokens, output_tokens, cost_usd)
     values ($1, $2, 'student_assistant', 'claude-opus-5-5', 1000, 100, 0.5), ($1, $3, 'admissions_agent', 'claude-opus-5-5', 500, 50, 0.25),
            ($1, $2, 'ticketing', 'claude-opus-5-5', 200, 20, 0.1), ($4, $5, 'student_assistant', 'claude-opus-5-5', 9, 9, 7)`,
    [tenantA, U.s1, U.visitor, tenantB, U.studentB],
  )
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('who may see analytics', () => {
  it('needs analytics.view in that university and the analytics feature', async () => {
    for (const actor of [user(U.s1), user(U.registrar), user(U.ownerB), user(U.studentB)]) {
      await expect(overview(actor)).rejects.toMatchObject({ code: '42501' })
    }
    await expect(query(pool, anon, `select public.analytics_overview('uni-a', 7)`)).rejects.toMatchObject({ code: '42501' })
    await expect(overview(user(U.owner), 14)).rejects.toMatchObject({ code: '22023' })
    await setFeature(tenantA, 'analytics_basic', false)
    await expect(overview(user(U.owner))).rejects.toMatchObject({ code: '42501' })
    await setFeature(tenantA, 'analytics_basic', true)
  })

  it('periods over 30 days need advanced analytics', async () => {
    await setFeature(tenantA, 'analytics_advanced', false)
    await expect(overview(user(U.owner), 90)).rejects.toMatchObject({ code: '42501' })
    expect((await overview(user(U.owner), 30)).can.advanced).toBe(false)
    await setFeature(tenantA, 'analytics_advanced', true)
    expect((await overview(user(U.owner), 90)).period).toMatchObject({ days: 90, bucket: 'week' })
  })

  it('AI costs and quality numbers need their own permissions', async () => {
    const owner = await overview(user(U.owner))
    expect(owner.can).toEqual({ costs: true, gaps: true, review: true, advanced: true })
    expect(owner.ai).not.toBeNull()
    const dept = await overview(user(U.deptAdmin))
    expect(dept.can).toEqual({ costs: false, gaps: true, review: false, advanced: true })
    expect(dept.ai).toBeNull()
    expect(dept.quality).toBeNull()
    const reviewer = await overview(user(U.reviewer))
    expect(reviewer.can).toMatchObject({ costs: false, gaps: true, review: true })
    expect(reviewer.ai).toBeNull()
    expect(reviewer.quality).not.toBeNull()
  })
})

describe('numbers come from stored rows only', () => {
  it('counts questions, outcomes, people and feedback per assistant', async () => {
    const r = await overview(user(U.owner))
    expect(r.assistant.student).toMatchObject({ questions: 11, answered: 3, no_sources: 5, refused: 1, errors: 1, people: 3, helpful: 1, not_helpful: 2, median_latency_ms: 2000 })
    expect(r.assistant.admissions).toMatchObject({ questions: 2, answered: 1, no_sources: 1, people: 1, helpful: 0, not_helpful: 1 })
    expect(r.assistant.student.series).toHaveLength(7)
    expect(r.assistant.student.series.reduce((n: number, b: { questions: number }) => n + b.questions, 0)).toBe(11)
    expect(r.members.active).toBe(7)
  })

  it('longer periods include older rows; another university never counts', async () => {
    expect((await overview(user(U.owner), 30)).assistant.student.questions).toBe(11)
    const r = await overview(user(U.owner), 90)
    expect(r.assistant.student).toMatchObject({ questions: 12, answered: 4, not_helpful: 3 })
    expect(r.assistant.student.series).toHaveLength(13)
    const b = await overview(user(U.ownerB), 7, 'uni-b')
    expect(b.assistant.student).toMatchObject({ questions: 1, no_sources: 1 })
  })

  it('tickets: volume, backlog, response and resolution times, queues and categories', async () => {
    const t = (await overview(user(U.owner))).tickets
    expect(t).toMatchObject({
      created: 4,
      from_assistant: 1,
      resolved: 2,
      open_now: 3,
      open_by_status: { open: 2, in_progress: 1, waiting: 0 },
      unassigned_now: 2,
      awaiting_first_response: 2,
      median_first_response_minutes: 120,
      median_resolution_hours: 3,
    })
    expect(t.by_department.map((d: { name: string; open: number; created: number }) => [d.name, d.open, d.created])).toEqual([
      ['Registry', 2, 3],
      ['Human resources', 1, 1],
    ])
    expect(t.by_department[0].name_ar).toBe('التسجيل')
    expect(t.by_category.map((c: { name: string | null; created: number }) => [c.name, c.created])).toEqual([
      ['Transcripts', 2],
      [null, 2],
    ])
    expect(t.series.reduce((n: number, b: { created: number }) => n + b.created, 0)).toBe(4)
    expect(t.series.reduce((n: number, b: { resolved: number }) => n + b.resolved, 0)).toBe(2)
  })

  it('knowledge: published, expired and the most cited documents the viewer may read', async () => {
    const k = (await overview(user(U.owner))).knowledge
    expect(k).toMatchObject({ published: 3, expired: 1, unpublished: 1 })
    expect(k.top_cited.map((d: { title: string; answers: number }) => [d.title, d.answers])).toEqual([
      ['Registration guide', 2],
      ['HR salary scale', 1],
      ['Staff fee procedures', 1],
    ])
    // A department admin cannot read the HR document, so its title is not listed.
    const dept = (await overview(user(U.deptAdmin))).knowledge
    expect(dept.top_cited.map((d: { title: string }) => d.title)).toEqual(['Registration guide', 'Staff fee procedures'])
  })

  it('admissions inquiries and AI costs (month and period)', async () => {
    const r = await overview(user(U.owner))
    expect(r.admissions).toEqual({ leads: 2, by_source: { form: 1, assistant: 1, manual: 0 } })
    expect(r.ai.month).toEqual({ student_assistant: 0.5, admissions_agent: 0.25, ticketing: 0.1, academic_agent: 0, staff_assistant: 0, workflow_agent: 0 })
    expect(r.ai.budgets.student_assistant).toBe(25)
    expect(r.ai.period).toMatchObject({ calls: 3, cost_usd: 0.85, input_tokens: 1700, output_tokens: 170 })
  })

  it('sections of features that are off are empty', async () => {
    await setFeature(tenantA, 'ticketing', false)
    await setFeature(tenantA, 'admissions_agent', false)
    const r = await overview(user(U.owner))
    expect(r.tickets).toBeNull()
    expect(r.admissions).toBeNull()
    expect(Object.keys(r.assistant).sort()).toEqual(['staff', 'student']) // the staff assistant (Phase 10) is on by default
    await setFeature(tenantA, 'ticketing', true)
    await setFeature(tenantA, 'admissions_agent', true)
  })

  it('days are the university’s own days, and the period starts at its midnight', async () => {
    const tenantC = (await pool.query(`select public.create_tenant('uni-c', 'University C', $1, 'en', 'Pacific/Kiritimati') as id`, [U.ownerC])).rows[0].id
    await addMember(tenantC, U.studentC, 'student')
    const before = await overview(user(U.ownerC), 7, 'uni-c')
    const local = (await pool.query(`select (now() at time zone 'Pacific/Kiritimati')::date::text as d`)).rows[0].d
    expect(before.period.to).toBe(local)
    expect(before.period.timezone).toBe('Pacific/Kiritimati')
    const since = new Date(before.period.since).getTime()
    const conv = await conversation(tenantC, U.studentC)
    await say(tenantC, conv, 'user', 'Just before the period', new Date(since - 60_000).toISOString())
    await say(tenantC, conv, 'user', 'Just after it began', new Date(since + 60_000).toISOString())
    await say(tenantC, conv, 'user', 'Now', new Date().toISOString())
    const after = await overview(user(U.ownerC), 7, 'uni-c')
    expect(after.assistant.student.questions).toBe(2)
    expect(after.assistant.student.series[0]).toMatchObject({ start: before.period.from, questions: 1 })
    expect(after.assistant.student.series[6]).toMatchObject({ start: local, questions: 1 })
  })
})

describe('knowledge gaps', () => {
  it('are grouped by question, most asked first, without the person or the conversation', async () => {
    const list = await gaps(user(U.reviewer))
    expect(list.map((g: { question: string; count: number }) => [g.question, g.count])).toEqual([
      ['متي التسجيل', 2],
      ['WHEN IS REGISTRATION ??', 2],
      ['Do you offer nursing?', 1],
      ['My student id is [number], email [email], phone [number], see [link] on 2026-11-23', 1],
    ])
    expect(Object.keys(list[0]).sort()).toEqual(['agents', 'count', 'first_at', 'last_at', 'open', 'open_ids', 'question', 'review', 'reviewed_ids'])
    expect(list[2].agents).toEqual(['admissions'])
    expect(JSON.stringify(list)).not.toContain(U.s1)
    expect(JSON.stringify(list)).not.toContain(U.s2)
  })

  it('knowledge managers may read them too; other staff, students and other universities may not', async () => {
    expect(await gaps(user(U.deptAdmin))).toHaveLength(4)
    for (const actor of [user(U.registrar), user(U.s1), user(U.ownerB), user(U.hr)]) {
      await expect(gaps(actor)).rejects.toMatchObject({ code: '42501' })
    }
    await expect(rpc(user(U.reviewer), `public.quality_gaps('uni-a', 14, null, 'open', 10)`)).rejects.toMatchObject({ code: '22023' })
    await expect(rpc(user(U.reviewer), `public.quality_gaps('uni-a', 7, 'staff', 'open', 10)`)).rejects.toMatchObject({ code: '22023' })
  })

  it('filter by assistant, and follow the features that are on', async () => {
    expect((await gaps(user(U.reviewer), { agent: 'admissions' })).map((g: { question: string }) => g.question)).toEqual(['Do you offer nursing?'])
    await setFeature(tenantA, 'admissions_agent', false)
    expect(await gaps(user(U.reviewer))).toHaveLength(3)
    await setFeature(tenantA, 'admissions_agent', true)
  })
})

describe('flagged answers', () => {
  it('rated not helpful: newest first, one exchange, redacted, without the person', async () => {
    const list = await flagged(user(U.reviewer), 'negative')
    expect(list.map((x: { id: string }) => x.id)).toEqual([A.a14, A.a9, A.a1])
    const a1 = list[2]
    expect(a1).toMatchObject({ agent: 'student', question: 'When is registration?', comment: 'Wrong date, email me at [email]', visible: true, answer: 'Registration opens on 1 December.' })
    expect(a1.citations).toEqual([{ n: 1, title: 'Doc 1', page_from: 1, page_to: 1, text: 'Quoted passage.', program: false }])
    expect(Object.keys(a1)).not.toContain('user_id')
    expect(JSON.stringify(list)).not.toContain(U.s1)
    expect(list[0]).toMatchObject({ agent: 'admissions', visible: true, answer: 'The MBA takes two years.' }) // program records are public
  })

  it('an answer built on a document the reviewer cannot read is withheld from them, not from the owner', async () => {
    const a9 = (await flagged(user(U.reviewer), 'negative')).find((x: { id: string }) => x.id === A.a9)
    expect(a9).toMatchObject({ question: 'What is the HR salary scale?', visible: false, answer: null, citations: [] })
    const owners = (await flagged(user(U.owner), 'negative')).find((x: { id: string }) => x.id === A.a9)
    expect(owners).toMatchObject({ visible: true, answer: 'Grade 5 earns 9000. Questions: [number].' })
  })

  it('declined answers, older periods, and who may look', async () => {
    expect((await flagged(user(U.reviewer), 'refused')).map((x: { question: string }) => x.question)).toEqual(['How do I cheat in the exam system?'])
    expect((await flagged(user(U.reviewer), 'negative', { days: 90 })).map((x: { id: string }) => x.id)).toContain(A.old)
    for (const actor of [user(U.deptAdmin), user(U.hr), user(U.s1), user(U.ownerB)]) {
      await expect(flagged(actor, 'negative')).rejects.toMatchObject({ code: '42501' })
    }
    await expect(flagged(user(U.reviewer), 'answered')).rejects.toMatchObject({ code: '22023' })
  })

  it('a deleted source document hides the answer, even from the owner (it can no longer be checked)', async () => {
    const conv = await conversation(tenantA, U.s2)
    const answer = await exchange(tenantA, conv, 'How are staff fees processed?', 0.2 * H, 'answered', 'By the finance office.', [D.staff])
    await rate(tenantA, answer, U.s2, -1, ago(60_000))
    const seen = async () => (await flagged(user(U.owner), 'negative')).find((x: { id: string }) => x.id === answer)
    expect(await seen()).toMatchObject({ visible: true, answer: 'By the finance office.' })
    await pool.query(`delete from public.knowledge_documents where id = $1`, [D.staff])
    expect(await seen()).toMatchObject({ visible: false, answer: null })
    await pool.query(`delete from public.assistant_feedback where message_id = $1`, [answer]) // keep later counts simple
  })

  it('the conversations themselves stay private: reviewers cannot read the tables', async () => {
    expect((await query(pool, user(U.reviewer), `select count(*)::int as n from public.assistant_messages`)).rows[0].n).toBe(0)
    expect((await query(pool, user(U.reviewer), `select count(*)::int as n from public.assistant_feedback`)).rows[0].n).toBe(0)
  })
})

describe('reviews', () => {
  it('a group of identical unanswered questions is reviewed at once', async () => {
    const english = (await gaps(user(U.reviewer))).find((g: { question: string }) => g.question === 'WHEN IS REGISTRATION ??')
    expect(english.open_ids.sort()).toEqual([A.a2, A.a3].sort())
    expect(await save(user(U.reviewer), english.open_ids, 'knowledge_added', 'Added the registration calendar')).toBe(2)
    expect((await gaps(user(U.reviewer))).map((g: { question: string }) => g.question)).not.toContain('WHEN IS REGISTRATION ??')
    const reviewed = await gaps(user(U.reviewer), { state: 'reviewed' })
    expect(reviewed).toHaveLength(1)
    expect(reviewed[0].review).toMatchObject({ outcome: 'knowledge_added', note: 'Added the registration calendar', reviewer: 'Rania Reviewer' })
  })

  it('flagged answers are reviewed one by one; saving again changes the outcome; reopening puts them back', async () => {
    await save(user(U.reviewer), [A.a1], 'correct')
    await save(user(U.reviewer), [A.a1], 'assistant_error', 'Read the wrong year')
    expect((await flagged(user(U.reviewer), 'negative')).map((x: { id: string }) => x.id)).toEqual([A.a14, A.a9])
    const done = await flagged(user(U.reviewer), 'negative', { state: 'reviewed' })
    expect(done.map((x: { id: string; review: { outcome: string } }) => [x.id, x.review.outcome])).toEqual([[A.a1, 'assistant_error']])
    const summary = await rpc(user(U.reviewer), `public.quality_summary('uni-a', 7)`)
    expect(summary).toEqual({
      gaps_open: 4,
      negative_open: 2,
      refused_open: 1,
      reviewed: 3,
      outcomes: { correct: 0, knowledge_added: 2, knowledge_needed: 0, assistant_error: 1, out_of_scope: 0 },
    })
    expect(await asCommitted(pool, user(U.reviewer), (c) => c.query(`select public.quality_review_reopen('uni-a', $1::uuid[]) as n`, [[A.a1]])).then((r) => r.rows[0].n)).toBe(1)
    expect((await flagged(user(U.reviewer), 'negative')).map((x: { id: string }) => x.id)).toContain(A.a1)
  })

  it('only flagged answers of this university, valid outcomes, and only reviewers', async () => {
    await expect(save(user(U.reviewer), [A.a8], 'correct')).rejects.toMatchObject({ code: '22023' }) // answered and rated helpful
    await expect(save(user(U.reviewer), [A.b1], 'correct')).rejects.toMatchObject({ code: '22023' }) // another university
    await expect(save(user(U.reviewer), [A.a2], 'great')).rejects.toMatchObject({ code: '22023' })
    await expect(save(user(U.reviewer), [], 'correct')).rejects.toMatchObject({ code: '22023' })
    await expect(save(user(U.reviewer), Array.from({ length: 201 }, () => A.a2!), 'correct')).rejects.toMatchObject({ code: '22023' })
    await expect(save(user(U.reviewer), [A.a2], 'correct', 'x'.repeat(2001))).rejects.toMatchObject({ code: '23514' })
    for (const actor of [user(U.deptAdmin), user(U.s1), user(U.ownerB)]) {
      await expect(save(actor, [A.a4], 'correct')).rejects.toMatchObject({ code: '42501' })
    }
  })

  it('review records are visible to reviewers of that university only, and stay out of the audit log', async () => {
    const n = async (actor: Actor) => (await query(pool, actor, `select count(*)::int as n from public.ai_quality_reviews`)).rows[0].n
    expect(await n(user(U.reviewer))).toBe(2)
    expect(await n(user(U.owner))).toBe(2)
    for (const actor of [user(U.deptAdmin), user(U.s1), user(U.ownerB)]) expect(await n(actor)).toBe(0)
    await expect(query(pool, user(U.reviewer), `insert into public.ai_quality_reviews (message_id, tenant_id, outcome, reviewer_name) values ($1, $2, 'correct', 'x')`, [A.a4, tenantA])).rejects.toMatchObject({ code: '42501' })
    const leaked = (await pool.query(`select count(*)::int as n from public.audit_logs where metadata::text ilike '%registration calendar%'`)).rows[0].n
    expect(leaked).toBe(0)
  })

  it('analytics reports the quality queue to reviewers', async () => {
    expect((await overview(user(U.owner))).quality).toMatchObject({ gaps_open: 4, negative_open: 3, refused_open: 1, reviewed: 2 })
  })
})

describe('helpers', () => {
  it('redaction keeps dates and short numbers', async () => {
    const r = async (s: string) => (await pool.query(`select app.redact_pii($1) as r`, [s])).rows[0].r
    expect(await r('Room 2045, course CS101, fees 1200, on 23/11/2026 and 2026-11-23')).toBe('Room 2045, course CS101, fees 1200, on 23/11/2026 and 2026-11-23')
    expect(await r('رقمي ٠٥٠١٢٣٤٥٦٧ شكرا')).toBe('رقمي [number] شكرا')
    expect(await r('Call 050-123-4567 or mail a.b@x.org')).toBe('Call [number] or mail [email]')
  })

  it('question grouping ignores case, punctuation, Arabic letter variants and diacritics', async () => {
    const n = async (s: string) => (await pool.query(`select app.normalize_question($1) as r`, [s])).rows[0].r
    expect(await n('  When is   Registration?? ')).toBe('when is registration')
    expect(await n('أين المكتبةُ؟')).toBe(await n('اين المكتبة'))
    expect(await n('رسوم الدراسة ٢٠٢٦')).toBe(await n('رسوم الدراسه 2026'))
  })
})
