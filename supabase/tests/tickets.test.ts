import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, as, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 7 (tickets and human handoff) database tests: routing, queue visibility per role and
 * department, internal-note privacy (also when the requester is staff), replies and status
 * rules, assignment and transfers, the shared conversation, AI budget and limits, notifications,
 * and that ticket content never reaches the append-only audit log.
 */

const U = {
  owner: '60000000-0000-4000-8000-00000000000a',
  registrar: '60000000-0000-4000-8000-0000000000a1', // Registry staff (no tickets.assign)
  deptAdmin: '60000000-0000-4000-8000-0000000000a2', // Registry department admin (tickets.assign)
  finance: '60000000-0000-4000-8000-0000000000a3', // Finance staff
  student1: '60000000-0000-4000-8000-0000000000a4',
  student2: '60000000-0000-4000-8000-0000000000a5',
  studentB: '60000000-0000-4000-8000-0000000000b4',
  staffB: '60000000-0000-4000-8000-0000000000b1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
let registry: string
let finance: string
let transcripts: string
let refunds: string
let ticket1: string

async function addMember(tenant: string, userId: string, roleKey: string, departmentId?: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
  if (departmentId) await pool.query(`insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`, [tenant, rows[0]!.id, departmentId])
}

const one = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, sql, params)).rows[0]
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(sql, params)).then((r) => r.rows[0])
const count = async (actor: Actor, table: string, where = 'true', params: unknown[] = []) => (await one(actor, `select count(*)::int as n from public.${table} where ${where}`, params)).n as number
const create = (actor: Actor, subject: string, category: string | null, conversation: string | null = null) =>
  run(actor, `select public.tickets_create('uni-a', $1, 'Please help me with this.', $2, $3) as r`, [subject, category, conversation]).then((r) => r.r as { id: string; reference: string })
const notified = async (userId: string, ticket: string) =>
  (await pool.query(`select kind from public.notifications where user_id = $1 and ticket_id = $2 order by id`, [userId, ticket])).rows.map((r) => r.kind)

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  await pool.query(`update public.profiles set full_name = 'Rana Registrar' where id = $1`, [U.registrar])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.staffB])).rows[0].id
  registry = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Registry', 'registry') returning id`, [tenantA])).rows[0].id
  finance = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Finance', 'finance') returning id`, [tenantA])).rows[0].id
  await addMember(tenantA, U.registrar, 'registrar', registry)
  await addMember(tenantA, U.deptAdmin, 'department_admin', registry)
  await addMember(tenantA, U.finance, 'finance_staff', finance)
  await addMember(tenantA, U.student1, 'student')
  await addMember(tenantA, U.student2, 'student')
  await addMember(tenantB, U.studentB, 'student')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('categories and routing rules', () => {
  it('only people who manage departments configure categories', async () => {
    const sql = `insert into public.ticket_categories (tenant_id, name, department_id, default_priority) values ($1, $2, $3, $4) returning id`
    await expect(query(pool, user(U.registrar), sql, [tenantA, 'Transcripts', registry, 'normal'])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.student1), sql, [tenantA, 'Transcripts', registry, 'normal'])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.staffB), sql, [tenantA, 'Transcripts', registry, 'normal'])).rejects.toMatchObject({ code: '42501' })
    transcripts = (await run(user(U.owner), sql, [tenantA, 'Transcripts', registry, 'normal'])).id
    refunds = (await run(user(U.owner), sql, [tenantA, 'Refunds', finance, 'high'])).id
  })

  it('members read the categories of their own university only', async () => {
    expect(await count(user(U.student1), 'ticket_categories')).toBe(2)
    expect(await count(user(U.studentB), 'ticket_categories')).toBe(0)
    await expect(query(pool, anon, `select count(*) from public.ticket_categories`)).rejects.toMatchObject({ code: '42501' })
  })

  it('a request is routed to the category department with its default priority and notifies that queue', async () => {
    const r = await create(user(U.student1), 'Need my transcript', transcripts)
    ticket1 = r.id
    expect(r.reference).toBe('T-00001')
    const t = (await pool.query(`select department_id, priority, status, source, requester_name from public.tickets where id = $1`, [ticket1])).rows[0]
    expect(t).toEqual({ department_id: registry, priority: 'normal', status: 'open', source: 'portal', requester_name: `${U.student1}@test.example` })
    expect(await notified(U.registrar, ticket1)).toEqual(['ticket_new'])
    expect(await notified(U.deptAdmin, ticket1)).toEqual(['ticket_new'])
    expect(await notified(U.owner, ticket1)).toEqual(['ticket_new']) // read_all
    expect(await notified(U.finance, ticket1)).toEqual([])
    const refund = await create(user(U.student2), 'Refund of fees', refunds)
    expect((await pool.query(`select priority, department_id from public.tickets where id = $1`, [refund.id])).rows[0]).toEqual({ priority: 'high', department_id: finance })
  })

  it('refuses inactive or foreign categories, other people’s conversations and other universities', async () => {
    await pool.query(`insert into public.ticket_categories (tenant_id, name, active) values ($1, 'Old', false)`, [tenantA])
    const old = (await pool.query(`select id from public.ticket_categories where name = 'Old'`)).rows[0].id
    await expect(create(user(U.student1), 'Old category', old)).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.studentB), `select public.tickets_create('uni-a', 'Hello there', 'x', null, null)`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.tickets_create('uni-a', 'Hello there', 'x', null, null)`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.student1), `select public.tickets_create('uni-a', 'x', 'x', null, null)`)).rejects.toMatchObject({ code: '23514' })
  })
})

describe('queues: who sees which ticket', () => {
  it('requesters see their own; staff their departments; owners everything; nobody else', async () => {
    const sees = async (actor: Actor) => (await query(pool, actor, `select subject from public.tickets order by subject`)).rows.map((r) => r.subject)
    expect(await sees(user(U.student1))).toEqual(['Need my transcript'])
    expect(await sees(user(U.student2))).toEqual(['Refund of fees'])
    expect(await sees(user(U.registrar))).toEqual(['Need my transcript'])
    expect(await sees(user(U.finance))).toEqual(['Refund of fees'])
    expect(await sees(user(U.owner))).toEqual(['Need my transcript', 'Refund of fees'])
    expect(await sees(user(U.studentB))).toEqual([])
    expect(await sees(user(U.staffB))).toEqual([])
    expect(await count(user(U.student2), 'ticket_messages', 'ticket_id = $1', [ticket1])).toBe(0)
  })
})

describe('internal notes stay internal', () => {
  it('staff write and read notes; the requester and other departments never see them', async () => {
    await expect(query(pool, user(U.student1), `select public.tickets_add_note($1, 'I am staff now')`, [ticket1])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.finance), `select public.tickets_add_note($1, 'Not my queue')`, [ticket1])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.registrar), `select public.tickets_add_note($1, 'Student owes a library fine')`, [ticket1])
    expect(await count(user(U.registrar), 'ticket_internal_notes')).toBe(1)
    expect(await count(user(U.deptAdmin), 'ticket_internal_notes')).toBe(1)
    expect(await count(user(U.owner), 'ticket_internal_notes')).toBe(1)
    for (const actor of [user(U.student1), user(U.student2), user(U.finance), user(U.staffB)]) expect(await count(actor, 'ticket_internal_notes')).toBe(0)
    // Notes never leak into the public thread the requester reads.
    expect((await query(pool, user(U.student1), `select body from public.ticket_messages where ticket_id = $1`, [ticket1])).rows.map((r) => r.body)).not.toContain('Student owes a library fine')
  })

  it('a staff member who files their own ticket does not see the notes about it', async () => {
    const own = await create(user(U.registrar), 'My own certificate', transcripts)
    await run(user(U.deptAdmin), `select public.tickets_add_note($1, 'Note about a colleague')`, [own.id])
    expect(await count(user(U.registrar), 'ticket_internal_notes', 'ticket_id = $1', [own.id])).toBe(0)
    await expect(query(pool, user(U.registrar), `select public.tickets_add_note($1, 'x')`, [own.id])).rejects.toMatchObject({ code: '42501' })
    // …and cannot work their own ticket as staff.
    await expect(query(pool, user(U.registrar), `select public.tickets_update($1, 'resolved', 'normal', null, $2, null)`, [own.id, registry])).rejects.toMatchObject({ code: '42501' })
    const reply = await run(user(U.registrar), `select public.tickets_reply($1, 'Any news?') as id`, [own.id])
    expect((await pool.query(`select from_staff from public.ticket_messages where id = $1`, [reply.id])).rows[0].from_staff).toBe(false)
  })

  it('history is for staff only', async () => {
    expect(await count(user(U.registrar), 'ticket_events', 'ticket_id = $1', [ticket1])).toBeGreaterThan(0)
    expect(await count(user(U.student1), 'ticket_events')).toBe(0)
  })
})

describe('replies and status', () => {
  it('a staff reply is the first response, moves an open ticket forward and notifies the requester', async () => {
    await run(user(U.registrar), `select public.tickets_reply($1, 'We are preparing it.')`, [ticket1])
    const t = (await pool.query(`select status, first_response_at from public.tickets where id = $1`, [ticket1])).rows[0]
    expect(t.status).toBe('in_progress')
    expect(t.first_response_at).not.toBeNull()
    expect(await notified(U.student1, ticket1)).toEqual(['ticket_reply'])
    const authors = (await query(pool, user(U.student1), `select author_name, from_staff from public.ticket_messages where ticket_id = $1 order by created_at`, [ticket1])).rows
    expect(authors.map((a) => a.from_staff)).toEqual([false, true])
    expect(authors[1].author_name).toBe('Rana Registrar')
  })

  it('others cannot reply, staff of other departments neither', async () => {
    await expect(query(pool, user(U.student2), `select public.tickets_reply($1, 'Hi')`, [ticket1])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.finance), `select public.tickets_reply($1, 'Hi')`, [ticket1])).rejects.toMatchObject({ code: '42501' })
  })
})

describe('assignment and transfers', () => {
  const update = (actor: Actor, status: string, assignee: string | null, department: string | null = registry, priority = 'normal') =>
    run(actor, `select public.tickets_update($1, $2, $3, $4, $5, $6)`, [ticket1, status, priority, transcripts, department, assignee])

  it('staff take a ticket themselves; assigning others and transfers need tickets.assign', async () => {
    await expect(update(user(U.registrar), 'in_progress', U.deptAdmin)).rejects.toMatchObject({ code: '42501' })
    await expect(update(user(U.registrar), 'in_progress', null, finance)).rejects.toMatchObject({ code: '42501' })
    await update(user(U.registrar), 'in_progress', U.registrar)
    expect((await pool.query(`select assignee_id from public.tickets where id = $1`, [ticket1])).rows[0].assignee_id).toBe(U.registrar)
  })

  it('without tickets.assign nobody can unassign a colleague (regression: NULL comparisons)', async () => {
    const other = await create(user(U.student1), 'Second transcript copy', transcripts)
    await run(user(U.deptAdmin), `select public.tickets_update($1, 'open', 'normal', $2, $3, $4)`, [other.id, transcripts, registry, U.deptAdmin])
    await expect(query(pool, user(U.registrar), `select public.tickets_update($1, 'open', 'normal', $2, $3, null)`, [other.id, transcripts, registry])).rejects.toMatchObject({ code: '42501' })
    // …but letting go of your own ticket is fine.
    await run(user(U.deptAdmin), `select public.tickets_update($1, 'open', 'normal', $2, $3, null)`, [other.id, transcripts, registry])
  })

  it('assignees must work the queue; department admins assign within it', async () => {
    await expect(update(user(U.deptAdmin), 'in_progress', U.finance)).rejects.toMatchObject({ code: '22023' })
    await expect(update(user(U.deptAdmin), 'in_progress', U.student2)).rejects.toMatchObject({ code: '22023' })
    await update(user(U.deptAdmin), 'in_progress', U.deptAdmin, registry, 'high')
    expect(await notified(U.deptAdmin, ticket1)).toEqual(['ticket_new']) // taking it yourself notifies nobody
    await update(user(U.deptAdmin), 'in_progress', U.registrar, registry, 'high')
    expect((await notified(U.registrar, ticket1)).at(-1)).toBe('ticket_assigned')
  })

  it('resolving notifies the requester; a requester reply reopens it', async () => {
    await update(user(U.registrar), 'resolved', U.registrar, registry, 'high')
    expect((await pool.query(`select status, resolved_at from public.tickets where id = $1`, [ticket1])).rows[0].resolved_at).not.toBeNull()
    expect(await notified(U.student1, ticket1)).toEqual(['ticket_reply', 'ticket_status'])
    await run(user(U.student1), `select public.tickets_reply($1, 'It is not solved yet')`, [ticket1])
    expect((await pool.query(`select status, resolved_at from public.tickets where id = $1`, [ticket1])).rows[0]).toEqual({ status: 'open', resolved_at: null })
    expect((await notified(U.registrar, ticket1)).at(-1)).toBe('ticket_reply') // the assignee
  })

  it('a transfer moves the ticket to the other queue; the assignee keeps access', async () => {
    await update(user(U.deptAdmin), 'open', U.registrar, finance, 'high')
    expect(await count(user(U.finance), 'tickets', 'id = $1', [ticket1])).toBe(1)
    expect(await notified(U.finance, ticket1)).toEqual(['ticket_new'])
    expect(await count(user(U.registrar), 'tickets', 'id = $1', [ticket1])).toBe(1) // assignee
    expect(await count(user(U.deptAdmin), 'tickets', 'id = $1', [ticket1])).toBe(0) // left the Registry queue
    const events = (await query(pool, user(U.owner), `select kind from public.ticket_events where ticket_id = $1 order by id`, [ticket1])).rows.map((r) => r.kind)
    expect(events).toEqual(expect.arrayContaining(['created', 'status', 'assigned', 'priority', 'department']))
  })

  it('the requester closes the ticket; closed tickets take no more replies', async () => {
    await expect(query(pool, user(U.student2), `select public.tickets_close($1)`, [ticket1])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.student1), `select public.tickets_close($1)`, [ticket1])
    expect((await pool.query(`select status from public.tickets where id = $1`, [ticket1])).rows[0].status).toBe('closed')
    await expect(query(pool, user(U.student1), `select public.tickets_reply($1, 'One more thing')`, [ticket1])).rejects.toMatchObject({ code: '55000' })
  })
})

describe('handoff from the student assistant', () => {
  let conversation: string
  let shared: string

  it('a student shares their own conversation; staff read it up to the moment of the handoff', async () => {
    await run(user(U.owner), `select public.assistant_update_settings('uni-a', true, null, 10)`)
    conversation = (await run(user(U.student1), `select public.assistant_begin_turn('uni-a', null, 'How do I get my transcript?') as r`)).r.conversation_id
    await run(user(U.student1), `select public.assistant_complete_turn($1, 'I could not find this.', 'no_sources', '[]', '[]', null, null, 10)`, [conversation])
    await expect(create(user(U.student2), 'Stolen conversation', transcripts, conversation)).rejects.toMatchObject({ code: '22023' })
    shared = (await create(user(U.student1), 'Transcript help (from chat)', transcripts, conversation)).id
    expect((await pool.query(`select source from public.tickets where id = $1`, [shared])).rows[0].source).toBe('assistant')
    // Later messages in the same conversation are not shared.
    await pool.query(`insert into public.assistant_messages (tenant_id, conversation_id, role, content, status, created_at) values ($1, $2, 'user', 'A later private question', 'question', now() + interval '1 minute')`, [tenantA, conversation])
    const msgs = (await one(user(U.registrar), `select public.tickets_shared_conversation($1) as r`, [shared])).r
    expect(msgs.map((m: { content: string }) => m.content)).toEqual(['How do I get my transcript?', 'I could not find this.'])
  })

  it('only staff who work the ticket read the shared conversation', async () => {
    for (const actor of [user(U.finance), user(U.student2), user(U.student1)]) {
      await expect(query(pool, actor, `select public.tickets_shared_conversation($1)`, [shared])).rejects.toMatchObject({ code: '42501' })
    }
  })
})

describe('AI help: budget and limits', () => {
  it('needs an AI budget left; usage is booked to the student-support budget', async () => {
    await as(pool, user(U.owner), async (c) => {
      await c.query(`reset role`)
      await c.query(`delete from public.assistant_settings where tenant_id = $1`, [tenantA])
      await c.query(`set local role authenticated`)
      await expect(c.query(`select public.tickets_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '53400' })
    })
    await run(user(U.student1), `select public.tickets_ai_begin('uni-a')`)
    await run(user(U.student1), `select public.tickets_ai_record('uni-a', 'claude-opus-5-5', $1)`, [JSON.stringify({ input_tokens: 500, output_tokens: 100, cost_usd: 0.004 })])
    expect(Number((await pool.query(`select app.assistant_month_cost($1) as c`, [tenantA])).rows[0].c)).toBeCloseTo(0.004, 6)
    await expect(query(pool, user(U.studentB), `select public.tickets_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('stops a person after 30 AI calls a day', async () => {
    await pool.query(`insert into public.ai_usage_events (tenant_id, user_id, feature, model) select $1, $2, 'ticketing', 'claude-opus-5-5' from generate_series(1, 29)`, [tenantA, U.student1])
    await expect(query(pool, user(U.student1), `select public.tickets_ai_begin('uni-a')`)).rejects.toMatchObject({ code: '54000' })
    await run(user(U.student2), `select public.tickets_ai_begin('uni-a')`)
  })

  it('AI summaries are internal notes: staff see them, the requester never does', async () => {
    const t = (await pool.query(`select id from public.tickets where subject = 'Transcript help (from chat)'`)).rows[0].id
    await expect(query(pool, user(U.student1), `select public.tickets_add_ai_summary($1, 'x', 'claude-opus-5-5')`, [t])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.registrar), `select public.tickets_add_ai_summary($1, 'Student needs an official transcript.', 'claude-opus-5-5')`, [t])
    expect(await count(user(U.registrar), 'ticket_internal_notes', `ticket_id = $1 and kind = 'ai_summary'`, [t])).toBe(1)
    expect(await count(user(U.student1), 'ticket_internal_notes', 'ticket_id = $1', [t])).toBe(0)
  })
})

describe('notifications', () => {
  it('each person reads and clears only their own', async () => {
    const mine = (await one(user(U.student1), `select public.my_notifications('uni-a', 30) as r`)).r
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((n: { mine: boolean }) => n.mine)).toBe(true)
    expect(await count(user(U.student2), 'notifications', 'user_id = $1', [U.student1])).toBe(0)
    const cleared = (await run(user(U.student1), `select public.notifications_mark_read('uni-a', null) as n`)).n
    expect(cleared).toBe(mine.filter((n: { read: boolean }) => !n.read).length)
    expect(await count(user(U.student1), 'notifications', 'read_at is null')).toBe(0)
    expect(await count(user(U.registrar), 'notifications', 'read_at is null')).toBeGreaterThan(0)
    await expect(query(pool, user(U.studentB), `select public.my_notifications('uni-a', 30)`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('limits and privacy of records', () => {
  it('at most 10 new requests per person per day', async () => {
    const today = async () => (await pool.query(`select count(*)::int as n from public.tickets where requester_id = $1`, [U.student2])).rows[0].n as number
    let i = 0
    while ((await today()) < 10) await create(user(U.student2), `Request number ${i++}`, null)
    await expect(create(user(U.student2), 'One too many', null)).rejects.toMatchObject({ code: '54000' })
  })

  it('requests without a category reach only people who see all tickets', async () => {
    const t = (await pool.query(`select id from public.tickets where subject = 'Request number 0'`)).rows[0].id
    expect(await count(user(U.registrar), 'tickets', 'id = $1', [t])).toBe(0)
    expect(await count(user(U.owner), 'tickets', 'id = $1', [t])).toBe(1)
  })

  it('ticket content never reaches the append-only audit log', async () => {
    const leaked = (await pool.query(`select count(*)::int as n from public.audit_logs where metadata::text ilike any (array['%library fine%', '%Please help me%', '%not solved yet%'])`)).rows[0].n
    expect(leaked).toBe(0)
  })

  it('turning the feature off hides tickets and closes the door', async () => {
    await as(pool, user(U.owner), async (c) => {
      await c.query(`reset role`)
      await c.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'ticketing'`, [tenantA])
      await c.query(`set local role authenticated`)
      expect((await c.query(`select count(*)::int as n from public.tickets`)).rows[0].n).toBe(0)
      await expect(c.query(`select public.tickets_create('uni-a', 'Hello there', 'x', null, null)`)).rejects.toMatchObject({ code: '42501' })
    })
  })
})
