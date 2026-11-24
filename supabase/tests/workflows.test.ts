import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 11 (service request workflows) database tests: who manages forms; versions that never
 * change once published; answers checked against the version the requester saw; tracking
 * numbers; who sees and processes which requests (department queues, never one's own);
 * internal notes and assignments hidden from requesters; the status flow and its messages;
 * notifications; the AI suggestion gate; analytics; audit; other universities.
 */

const U = {
  owner: '91000000-0000-4000-8000-00000000000a', // manages forms; tickets.read_all
  registrar: '91000000-0000-4000-8000-0000000000a1', // Registry queue, no tickets.assign
  registrar2: '91000000-0000-4000-8000-0000000000a2', // Registry queue
  deptAdmin: '91000000-0000-4000-8000-0000000000a3', // Registry department admin: tickets.assign
  finance: '91000000-0000-4000-8000-0000000000a4', // Finance queue
  student: '91000000-0000-4000-8000-0000000000a5',
  student2: '91000000-0000-4000-8000-0000000000a6',
  ownerB: '91000000-0000-4000-8000-00000000000b',
  studentB: '91000000-0000-4000-8000-0000000000b1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let registry: string
let financeDept: string
let transcript: string // a Registry form
let general: string // a form without a department (general queue)

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(`select ${sql} as r`, params)).then((r) => r.rows[0].r)
const count = async (actor: Actor, table: string, where = 'true', params: unknown[] = []) =>
  (await query(pool, actor, `select count(*)::int as n from ${table} where ${where}`, params)).rows[0].n as number

async function addMember(tenant: string, userId: string, roleKey: string, departmentId?: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
  if (departmentId) await pool.query(`insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`, [tenant, rows[0]!.id, departmentId])
}

const FIELDS = [
  { key: 'copies', type: 'number', label: 'Copies', required: true },
  { key: 'delivery', type: 'select', label: 'Delivery', required: true, options: [{ value: 'pickup', label: 'Pick up' }, { value: 'email', label: 'By email', label_ar: 'بالبريد' }] },
  { key: 'email', type: 'email', label: 'Email', required: false },
  { key: 'needed_by', type: 'date', label: 'Needed by', required: false },
  { key: 'notes', type: 'textarea', label: 'Notes', required: false, help: 'Anything else' },
  { key: 'confirm', type: 'checkbox', label: 'I confirm the details are correct', required: true },
]
const ANSWERS = { copies: '2', delivery: 'email', email: ' sara@example.edu ', needed_by: '2026-12-15', notes: 'Please send to the embassy.', confirm: true }

const saveDefinition = (actor: Actor, key: string, department: string | null, id: string | null = null) =>
  run(actor, `public.workflow_save_definition('uni-a', $1, $2, $3, null, 'For official use', null, $4)`, [id, key, `Form ${key}`, department])
const saveDraft = (actor: Actor, definition: string, fields: unknown = FIELDS) =>
  run(actor, `public.workflow_save_draft($1, $2, 'Allow 5 working days.', null, 'I confirm this request.', null)`, [definition, JSON.stringify(fields)])
const currentVersion = async (definition: string) => (await pool.query(`select current_version_id from public.workflow_definitions where id = $1`, [definition])).rows[0].current_version_id as string
const submit = async (actor: Actor, definition: string, answers: unknown = ANSWERS, version?: string, slug = 'uni-a') =>
  run(actor, `public.workflow_submit($1, $2, $3, $4, 'form')`, [slug, definition, version ?? (await currentVersion(definition)), JSON.stringify(answers)])
const statusOf = async (id: string) => (await pool.query(`select status from public.workflow_requests where id = $1`, [id])).rows[0].status as string

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  const tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  registry = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Registry', 'registry') returning id`, [tenantA])).rows[0].id
  financeDept = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Finance', 'finance') returning id`, [tenantA])).rows[0].id
  await addMember(tenantA, U.registrar, 'registrar', registry)
  await addMember(tenantA, U.registrar2, 'registrar', registry)
  await addMember(tenantA, U.deptAdmin, 'department_admin', registry)
  await addMember(tenantA, U.finance, 'finance_staff', financeDept)
  await addMember(tenantA, U.student, 'student')
  await addMember(tenantA, U.student2, 'student')
  await addMember(tenantB, U.studentB, 'student')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('forms are managed by form managers and versioned', () => {
  it('only managers create and edit forms; keys are unique per university', async () => {
    for (const actor of [U.registrar, U.deptAdmin, U.student, U.ownerB]) await expect(saveDefinition(user(actor), 'transcript', registry)).rejects.toMatchObject({ code: '42501' })
    transcript = await saveDefinition(user(U.owner), 'transcript', registry)
    general = await saveDefinition(user(U.owner), 'general-letter', null)
    await expect(saveDefinition(user(U.owner), 'transcript', null)).rejects.toMatchObject({ code: '23505' })
    await expect(saveDraft(user(U.registrar), transcript)).rejects.toMatchObject({ code: '42501' })
  })

  it('field definitions are checked', async () => {
    const bad = [
      [],
      [{ key: 'a', type: 'text', label: 'A', required: true }, { key: 'a', type: 'text', label: 'B', required: false }], // duplicate key
      [{ key: 'a', type: 'file', label: 'A', required: true }], // unknown type
      [{ key: 'a', type: 'select', label: 'A', required: true }], // select without options
      [{ key: 'a', type: 'select', label: 'A', required: true, options: [{ value: 'x', label: 'X' }, { value: 'x', label: 'Y' }] }],
      [{ key: 'a', type: 'text', label: 'A', required: true, options: [] }], // options on a text field
      [{ key: 'a', type: 'text', label: 'A', required: 'yes' }],
      [{ key: 'a', type: 'text', label: 'A', required: true, script: '<x>' }], // unknown property
      [{ key: 'Bad Key', type: 'text', label: 'A', required: true }],
      Array.from({ length: 31 }, (_, i) => ({ key: `f${i}`, type: 'text', label: 'A', required: false })),
    ]
    for (const fields of bad) await expect(saveDraft(user(U.owner), transcript, fields)).rejects.toMatchObject({ code: '22023' })
  })

  it('drafts are visible to managers only; publishing makes the form visible to members', async () => {
    await saveDraft(user(U.owner), transcript)
    await saveDraft(user(U.owner), general, [{ key: 'purpose', type: 'textarea', label: 'Purpose', required: true }])
    for (const actor of [U.student, U.registrar]) {
      expect(await count(user(actor), 'public.workflow_definitions')).toBe(0)
      expect(await count(user(actor), 'public.workflow_versions')).toBe(0)
    }
    expect(await count(user(U.owner), 'public.workflow_versions')).toBe(2)
    await expect(run(user(U.registrar), `public.workflow_publish($1)`, [transcript])).rejects.toMatchObject({ code: '42501' })
    expect(await run(user(U.owner), `public.workflow_publish($1)`, [transcript])).toBe(1)
    expect(await run(user(U.owner), `public.workflow_publish($1)`, [general])).toBe(1)
    await expect(run(user(U.owner), `public.workflow_publish($1)`, [transcript])).rejects.toMatchObject({ code: '22023' }) // nothing to publish
    expect(await count(user(U.student), 'public.workflow_definitions', `status = 'active'`)).toBe(2)
    expect(await count(user(U.student), 'public.workflow_versions', `status = 'published'`)).toBe(2)
    for (const actor of [U.ownerB, U.studentB]) expect(await count(user(actor), 'public.workflow_definitions')).toBe(0)
    await expect(query(pool, anon, `select * from public.workflow_definitions`)).rejects.toMatchObject({ code: '42501' })
  })

  it('a published version never changes; a new draft does not affect requesters until published', async () => {
    const v1 = await currentVersion(transcript)
    await expect(pool.query(`update public.workflow_versions set fields = '[{"key":"x","type":"text","label":"X","required":false}]' where id = $1`, [v1])).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query(`update public.workflow_versions set status = 'draft' where id = $1`, [v1])).rejects.toMatchObject({ code: '55000' })
    await saveDraft(user(U.owner), transcript, [...FIELDS, { key: 'purpose', type: 'text', label: 'Purpose', required: false }])
    expect(await count(user(U.student), 'public.workflow_versions', `definition_id = $1`, [transcript])).toBe(1) // the draft stays hidden
    expect(await currentVersion(transcript)).toBe(v1)
  })
})

describe('requests', () => {
  let r1: string // the student's transcript request (Registry)

  it('are submitted against the version the requester saw, with a tracking number and normalized answers', async () => {
    const res = await submit(user(U.student), transcript)
    r1 = res.id
    expect(res.reference).toBe('R-00001')
    const row = (await pool.query(`select * from public.workflow_requests where id = $1`, [r1])).rows[0]
    expect(row).toMatchObject({ status: 'submitted', department_id: registry, requester_id: U.student, source: 'form' })
    expect(row.answers).toEqual({ copies: 2, delivery: 'email', email: 'sara@example.edu', needed_by: '2026-12-15', notes: 'Please send to the embassy.', confirm: true })
    expect((await submit(user(U.student2), general, { purpose: 'Visa letter' })).reference).toBe('R-00002')
  })

  it('refuses answers that do not fit the form', async () => {
    const bad = [
      { ...ANSWERS, copies: '' }, // required
      { ...ANSWERS, confirm: false }, // a required checkbox must be ticked
      { ...ANSWERS, delivery: 'courier' }, // not an option
      { ...ANSWERS, email: 'not-an-email' },
      { ...ANSWERS, needed_by: '2026-02-30' },
      { ...ANSWERS, copies: 'two' },
      { ...ANSWERS, extra: 'x' }, // unknown field
      { ...ANSWERS, notes: 'x'.repeat(4001) },
    ]
    for (const answers of bad) await expect(submit(user(U.student), transcript, answers)).rejects.toMatchObject({ code: '22023' })
  })

  it('after a new version is published, the old one is refused (review again) and old requests keep their version', async () => {
    const v1 = await currentVersion(transcript)
    expect(await run(user(U.owner), `public.workflow_publish($1)`, [transcript])).toBe(2)
    await expect(submit(user(U.student), transcript, ANSWERS, v1)).rejects.toMatchObject({ code: '40001' })
    expect((await pool.query(`select status from public.workflow_versions where id = $1`, [v1])).rows[0].status).toBe('retired')
    expect((await pool.query(`select version_id from public.workflow_requests where id = $1`, [r1])).rows[0].version_id).toBe(v1)
    expect(await count(user(U.student), 'public.workflow_versions', `id = $1`, [v1])).toBe(1) // retired versions stay readable
  })

  it('only members who may create requests, of an active form of their university', async () => {
    await expect(submit(user(U.studentB), transcript, ANSWERS, undefined, 'uni-b')).rejects.toMatchObject({ code: 'P0002' })
    await expect(submit(user(U.studentB), transcript, ANSWERS)).rejects.toMatchObject({ code: '42501' })
    await run(user(U.owner), `public.workflow_set_status($1, 'archived')`, [general])
    await expect(submit(user(U.student), general, { purpose: 'x' })).rejects.toMatchObject({ code: 'P0002' })
    await run(user(U.owner), `public.workflow_set_status($1, 'active')`, [general])
  })

  it('requesters see only their own; staff see their departments; the general queue needs tickets.read_all', async () => {
    expect(await count(user(U.student), 'public.workflow_requests')).toBe(1)
    expect(await count(user(U.student2), 'public.workflow_requests')).toBe(1)
    expect(await count(user(U.registrar), 'public.workflow_requests')).toBe(1) // the Registry request only
    expect(await count(user(U.finance), 'public.workflow_requests')).toBe(0)
    expect(await count(user(U.owner), 'public.workflow_requests')).toBe(2)
    for (const actor of [U.ownerB, U.studentB]) expect(await count(user(actor), 'public.workflow_requests')).toBe(0)
  })

  it('processors move a request along the status flow; some steps need a message for the requester', async () => {
    await expect(run(user(U.finance), `public.workflow_update_status($1, 'in_review', null)`, [r1])).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.student), `public.workflow_update_status($1, 'approved', null)`, [r1])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.registrar), `public.workflow_update_status($1, 'in_review', null)`, [r1])
    await expect(run(user(U.registrar), `public.workflow_update_status($1, 'needs_info', '')`, [r1])).rejects.toMatchObject({ code: '22023' })
    await expect(run(user(U.registrar), `public.workflow_update_status($1, 'cancelled', null)`, [r1])).rejects.toMatchObject({ code: '22023' })
    await expect(run(user(U.registrar), `public.workflow_update_status($1, 'submitted', null)`, [r1])).rejects.toMatchObject({ code: '22023' })
    await run(user(U.registrar), `public.workflow_update_status($1, 'needs_info', 'Please add the embassy address.')`, [r1])
    expect(await statusOf(r1)).toBe('needs_info')
  })

  it('the requester answers; the request goes back to review; internal notes and assignments stay hidden from them', async () => {
    await run(user(U.student), `public.workflow_comment($1, 'Embassy of X, Main Street 1.', false)`, [r1])
    expect(await statusOf(r1)).toBe('in_review')
    await expect(run(user(U.student), `public.workflow_comment($1, 'secret', true)`, [r1])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.registrar), `public.workflow_comment($1, 'Address checked by phone.', true)`, [r1])
    await run(user(U.registrar), `public.workflow_assign($1, $2)`, [r1, U.registrar])
    const studentKinds = (await query(pool, user(U.student), `select kind from public.workflow_request_events where request_id = $1 order by id`, [r1])).rows.map((r) => r.kind)
    expect(studentKinds).toEqual(['submitted', 'status', 'status', 'comment', 'status'])
    expect(await count(user(U.registrar), 'public.workflow_request_events', `request_id = $1 and internal`, [r1])).toBe(2)
    expect(await count(user(U.finance), 'public.workflow_request_events', `request_id = $1`, [r1])).toBe(0)
    await expect(run(user(U.finance), `public.workflow_comment($1, 'hello', false)`, [r1])).rejects.toMatchObject({ code: '42501' })
    // The needs_info message reached the requester.
    expect(await count(user(U.student), 'public.workflow_request_events', `request_id = $1 and body = 'Please add the embassy address.'`, [r1])).toBe(1)
  })

  it('assigning others needs tickets.assign and someone who works the queue', async () => {
    await expect(run(user(U.registrar), `public.workflow_assign($1, $2)`, [r1, U.registrar2])).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.deptAdmin), `public.workflow_assign($1, $2)`, [r1, U.finance])).rejects.toMatchObject({ code: '22023' })
    await expect(run(user(U.deptAdmin), `public.workflow_assign($1, $2)`, [r1, U.student])).rejects.toMatchObject({ code: '22023' })
    await run(user(U.deptAdmin), `public.workflow_assign($1, $2)`, [r1, U.registrar2])
    expect((await pool.query(`select assignee_id from public.workflow_requests where id = $1`, [r1])).rows[0].assignee_id).toBe(U.registrar2)
    await expect(run(user(U.registrar), `public.workflow_assign($1, null)`, [r1])).rejects.toMatchObject({ code: '42501' }) // not theirs
    const names = (await rpc(user(U.deptAdmin), `public.workflow_assignees('uni-a', $1)`, [registry])).map((a: { user_id: string }) => a.user_id).sort()
    expect(names).toEqual([U.owner, U.deptAdmin, U.registrar, U.registrar2].sort()) // the owner works every queue (tickets.read_all)
    await expect(rpc(user(U.registrar), `public.workflow_assignees('uni-a', $1)`, [registry])).rejects.toMatchObject({ code: '42501' })
  })

  it('nobody processes their own request, even in their own department', async () => {
    const own = (await submit(user(U.registrar), transcript, { ...ANSWERS, delivery: 'pickup' })).id
    await expect(run(user(U.registrar), `public.workflow_update_status($1, 'approved', null)`, [own])).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.registrar), `public.workflow_assign($1, $2)`, [own, U.registrar])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.registrar2), `public.workflow_comment($1, 'Internal check', true)`, [own])
    expect(await count(user(U.registrar), 'public.workflow_request_events', `request_id = $1 and internal`, [own])).toBe(0)
    await expect(run(user(U.registrar2), `public.workflow_assign($1, $2)`, [own, U.registrar])).rejects.toMatchObject({ code: '42501' }) // no tickets.assign
    await expect(run(user(U.deptAdmin), `public.workflow_assign($1, $2)`, [own, U.registrar])).rejects.toMatchObject({ code: '22023' })
  })

  it('approved, then completed; closed requests take no more comments; requesters cancel only undecided ones', async () => {
    await run(user(U.registrar2), `public.workflow_update_status($1, 'approved', 'Ready next week.')`, [r1])
    await expect(run(user(U.student), `public.workflow_cancel($1)`, [r1])).rejects.toMatchObject({ code: '55000' })
    await expect(run(user(U.registrar2), `public.workflow_update_status($1, 'rejected', 'Too late')`, [r1])).rejects.toMatchObject({ code: '22023' })
    await run(user(U.registrar2), `public.workflow_update_status($1, 'completed', null)`, [r1])
    expect((await pool.query(`select closed_at from public.workflow_requests where id = $1`, [r1])).rows[0].closed_at).not.toBeNull()
    await expect(run(user(U.student), `public.workflow_comment($1, 'Thanks', false)`, [r1])).rejects.toMatchObject({ code: '55000' })
    const second = (await submit(user(U.student), transcript)).id
    await expect(run(user(U.student2), `public.workflow_cancel($1)`, [second])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.student), `public.workflow_cancel($1)`, [second])
    expect(await statusOf(second)).toBe('cancelled')
  })

  it('notifies the other side, and the notification list shows tickets and requests', async () => {
    const kinds = async (actor: string) => ((await rpc(user(actor), `public.my_notifications('uni-a', 50)`)) as { kind: string }[]).map((n) => n.kind)
    expect(await kinds(U.registrar)).toContain('request_new')
    expect(await kinds(U.registrar)).toContain('request_comment')
    expect(await kinds(U.registrar2)).toContain('request_assigned')
    const student = (await rpc(user(U.student), `public.my_notifications('uni-a', 50)`)) as { kind: string; reference: string; subject: string; mine: boolean }[]
    expect(student.filter((n) => n.kind === 'request_status').length).toBeGreaterThanOrEqual(3)
    expect(student[0]).toMatchObject({ reference: 'R-00001', subject: 'Form transcript', mine: true })
    expect(await kinds(U.finance)).toEqual([])
  })
})

describe('forms with requests', () => {
  it('cannot be deleted (archive instead); a form without requests can be', async () => {
    await expect(run(user(U.owner), `public.workflow_delete_definition($1)`, [transcript])).rejects.toMatchObject({ code: '23503' })
    const unused = await saveDefinition(user(U.owner), 'unused-form', financeDept)
    await saveDraft(user(U.owner), unused)
    await run(user(U.owner), `public.workflow_publish($1)`, [unused])
    await expect(run(user(U.registrar), `public.workflow_delete_definition($1)`, [unused])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.owner), `public.workflow_delete_definition($1)`, [unused])
    expect((await pool.query(`select count(*)::int as n from public.workflow_versions where definition_id = $1`, [unused])).rows[0].n).toBe(0)
  })
})

describe('the AI form suggestion', () => {
  const settings = (actor: Actor, enabled: boolean, budget = 10, limit = 20) => run(actor, `public.workflow_update_settings('uni-a', $1, $2, $3)`, [enabled, budget, limit])

  it('is off until an assistant administrator turns it on; then budget and daily limit apply', async () => {
    await expect(run(user(U.student), `public.workflow_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '55000' })
    for (const actor of [U.registrar, U.student, U.ownerB]) await expect(settings(user(actor), true)).rejects.toMatchObject({ code: '42501' })
    await settings(user(U.owner), true)
    expect(await rpc(user(U.student), `public.workflow_status('uni-a')`)).toEqual({ feature: true, can_submit: true, ai_enabled: true, ai_within_budget: true })
    await run(user(U.student), `public.workflow_ai_begin('uni-a')`)
    await run(user(U.student), `public.workflow_ai_record('uni-a', 'claude-opus-5-5', '{"input_tokens": 1000, "output_tokens": 200, "cost_usd": 0.01}')`)
    await settings(user(U.owner), true, 10, 1)
    await expect(run(user(U.student), `public.workflow_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '54000' })
    await run(user(U.student2), `public.workflow_ai_begin('uni-a')`) // another person still can
    await settings(user(U.owner), true, 0, 20)
    await expect(run(user(U.student2), `public.workflow_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '53400' })
    await settings(user(U.owner), true, 10, 20)
    await expect(run(user(U.studentB), `public.workflow_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    expect(await count(user(U.owner), 'public.workflow_settings')).toBe(1)
    expect(await count(user(U.registrar), 'public.workflow_settings')).toBe(0)
  })
})

describe('analytics, audit and the feature switch', () => {
  it('analytics counts requests and the suggestion cost, without people', async () => {
    const a = await rpc(user(U.owner), `public.analytics_overview('uni-a', 7)`)
    expect(a.workflows).toMatchObject({ submitted: 4, completed: 1, cancelled: 1, open_now: 2 })
    expect(a.workflows.by_form[0]).toMatchObject({ title: 'Form transcript', submitted: 3 })
    expect(JSON.stringify(a.workflows)).not.toContain(U.student)
    expect(a.ai.month.workflow_agent).toBeGreaterThan(0)
    expect(a.ai.budgets.workflow_agent).toBe(10)
    const usage = await rpc(user(U.owner), `public.workflow_usage('uni-a')`)
    expect(usage).toMatchObject({ requests: 4, from_assistant: 0, suggestions: 1 })
    await expect(rpc(user(U.registrar), `public.workflow_usage('uni-a')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('forms and settings are audited; requests, answers and comments are not', async () => {
    const actions = (await pool.query(`select distinct action from public.audit_logs where action like 'workflow_%' order by action`)).rows.map((r) => r.action)
    expect(actions).toEqual(expect.arrayContaining(['workflow_definitions.insert', 'workflow_versions.insert', 'workflow_versions.update', 'workflow_settings.insert']))
    expect(actions.some((a: string) => a.startsWith('workflow_requests') || a.startsWith('workflow_request_events'))).toBe(false)
    const leaked = (await pool.query(`select count(*)::int as n from public.audit_logs where metadata::text ilike any (array['%embassy%', '%sara@example.edu%'])`)).rows[0].n
    expect(leaked).toBe(0)
  })

  it('without the feature nothing is visible or possible', async () => {
    await pool.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'workflow_agent'`, [tenantA])
    for (const actor of [U.owner, U.student, U.registrar]) {
      expect(await count(user(actor), 'public.workflow_requests')).toBe(0)
      expect(await count(user(actor), 'public.workflow_definitions')).toBe(0)
    }
    await expect(submit(user(U.student), transcript)).rejects.toMatchObject({ code: '42501' })
    await expect(saveDefinition(user(U.owner), 'another', null)).rejects.toMatchObject({ code: '42501' })
    expect((await rpc(user(U.owner), `public.analytics_overview('uni-a', 7)`)).workflows).toBeNull()
    await pool.query(`update public.tenant_features set enabled = true where tenant_id = $1 and feature_key = 'workflow_agent'`, [tenantA])
  })
})
