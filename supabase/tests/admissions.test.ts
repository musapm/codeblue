import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, as, asCommitted, createTestDatabase, query, user, visitor, type Actor } from './harness'

/**
 * Phase 6 (admissions) database tests: the public page, programs, consented inquiries from
 * anonymous visitors, lead privacy and the staff pipeline, the admissions assistant (agent
 * separation, per-visitor limits, budget) and public-only retrieval.
 */

const U = {
  ownerA: '40000000-0000-4000-8000-00000000000a',
  staffA: '40000000-0000-4000-8000-0000000000a1',
  studentA: '40000000-0000-4000-8000-0000000000a3',
  ownerB: '40000000-0000-4000-8000-00000000000b',
  staffB: '40000000-0000-4000-8000-0000000000b1',
  visitor1: '40000000-0000-4000-8000-0000000000f1',
  visitor2: '40000000-0000-4000-8000-0000000000f2',
}
const CONSENT = 'I agree that the admissions office may contact me about my inquiry.'

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
let programA: string
let draftProgramA: string
let programB: string

async function addMember(tenant: string, userId: string, roleKey: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(
    `insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`,
    [tenant, rows[0]!.id, roleKey],
  )
}

const one = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, sql, params)).rows[0]
const committed = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(sql, params)).then((r) => r.rows[0])

const submit = (actor: Actor, slug: string, over: Partial<{ name: string; email: string | null; phone: string | null; program: string | null; consent: string; conversation: string | null }> = {}) =>
  committed(actor, `select public.admissions_submit_lead($1, $2, $3, $4, 'Sudan', $5, 'September 2027', 'Tell me more', 'en', '1', $6, $7) as r`, [
    slug,
    over.name ?? 'Amal Hassan',
    over.email === undefined ? 'amal@example.test' : over.email,
    over.phone === undefined ? null : over.phone,
    over.program === undefined ? programA : over.program,
    over.consent ?? CONSENT,
    over.conversation ?? null,
  ]).then((r) => r.r as { reference: string })

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [
    [U.ownerA, U.staffA, U.studentA, U.ownerB, U.staffB],
  ])
  // Anonymous sign-ins have no email.
  await pool.query(`insert into auth.users (id) select x from unnest($1::uuid[]) as x`, [[U.visitor1, U.visitor2]])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.ownerA])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  await addMember(tenantA, U.staffA, 'admissions_staff')
  await addMember(tenantA, U.studentA, 'student')
  await addMember(tenantB, U.staffB, 'admissions_staff')

  programA = (await committed(user(U.staffA), `insert into public.admission_programs (tenant_id, code, name, name_ar, level, tuition_amount, tuition_currency, tuition_period, status) values ($1, 'CS-BSC', 'Computer Science', 'علوم الحاسوب', 'bachelor', 1200, 'USD', 'semester', 'published') returning id`, [tenantA])).id
  draftProgramA = (await committed(user(U.staffA), `insert into public.admission_programs (tenant_id, code, name) values ($1, 'MED-DRAFT', 'Medicine (draft)') returning id`, [tenantA])).id
  programB = (await committed(user(U.staffB), `insert into public.admission_programs (tenant_id, code, name, status) values ($1, 'LAW', 'Law', 'published') returning id`, [tenantB])).id
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('public admissions page', () => {
  it('is hidden until the university publishes it, identically for unknown universities', async () => {
    expect((await one(anon, `select public.public_admissions('uni-a') as r`)).r).toBeNull()
    expect((await one(anon, `select public.public_admissions('no-such-uni') as r`)).r).toBeNull()
  })

  it('only admissions staff change the public settings', async () => {
    const args = [true, 'admissions@uni-a.example', 'https://uni-a.example/privacy', 'Welcome!', null, null, null]
    const sql = `select public.admissions_update_settings('uni-a', $1, $2, $3, $4, $5, $6, $7)`
    await expect(query(pool, user(U.studentA), sql, args)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.staffB), sql, args)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, visitor(U.visitor1), sql, args)).rejects.toMatchObject({ code: '42501' })
    await committed(user(U.staffA), sql, args)
  })

  it('shows only published programs, to anyone, without a session', async () => {
    const page = (await one(anon, `select public.public_admissions('uni-a') as r`)).r
    expect(page.tenant).toMatchObject({ slug: 'uni-a', name: 'University A' })
    expect(page.settings).toMatchObject({ assistant_enabled: false, contact_email: 'admissions@uni-a.example', consent_version: 1 })
    expect(page.programs.map((p: { code: string }) => p.code)).toEqual(['CS-BSC'])
    expect(page.programs[0]).toMatchObject({ name_ar: 'علوم الحاسوب', tuition_amount: 1200, tuition_currency: 'USD' })
    expect(JSON.stringify(page)).not.toMatch(/created_by|amal@/)
  })

  it('a suspended university or a disabled feature hides the page', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`reset role`)
      await c.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'admissions_agent'`, [tenantA])
      await c.query(`set local role anon`)
      expect((await c.query(`select public.public_admissions('uni-a') as r`)).rows[0].r).toBeNull()
    })
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`reset role`)
      await c.query(`update public.tenants set status = 'suspended' where id = $1`, [tenantA])
      await c.query(`set local role anon`)
      expect((await c.query(`select public.public_admissions('uni-a') as r`)).rows[0].r).toBeNull()
    })
  })

  it('a new consent wording is a new consent version', async () => {
    await committed(user(U.staffA), `select public.admissions_update_settings('uni-a', true, 'admissions@uni-a.example', null, null, null, $1, null)`, [
      'You agree that University A may contact you about admissions.',
    ])
    expect((await one(anon, `select public.public_admissions('uni-a') as r`)).r.settings.consent_version).toBe(2)
    await committed(user(U.staffA), `select public.admissions_update_settings('uni-a', true, 'admissions@uni-a.example', null, null, null, $1, null)`, [
      'You agree that University A may contact you about admissions.',
    ])
    expect((await one(anon, `select public.public_admissions('uni-a') as r`)).r.settings.consent_version).toBe(2)
  })
})

describe('programs', () => {
  it('staff with programs.manage write; students, visitors and other universities cannot', async () => {
    await expect(query(pool, user(U.studentA), `insert into public.admission_programs (tenant_id, code, name) values ($1, 'X', 'Xx')`, [tenantA])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, visitor(U.visitor1), `insert into public.admission_programs (tenant_id, code, name) values ($1, 'X', 'Xx')`, [tenantA])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.staffB), `insert into public.admission_programs (tenant_id, code, name) values ($1, 'X', 'Xx')`, [tenantA])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select * from public.admission_programs`)).rejects.toMatchObject({ code: '42501' })
    expect((await query(pool, user(U.staffB), `select id from public.admission_programs where tenant_id = $1`, [tenantA])).rows).toHaveLength(0)
    expect((await query(pool, user(U.studentA), `select id from public.admission_programs`)).rows).toHaveLength(0)
    expect((await query(pool, user(U.staffA), `update public.admission_programs set name = 'Hijack' where id = $1 returning id`, [programB])).rows).toHaveLength(0)
  })

  it('records who created it and when it was published', async () => {
    const row = await one(user(U.staffA), `select created_by, published_at from public.admission_programs where id = $1`, [programA])
    expect(row.created_by).toBe(U.staffA)
    expect(row.published_at).not.toBeNull()
    const draft = await one(user(U.staffA), `select published_at from public.admission_programs where id = $1`, [draftProgramA])
    expect(draft.published_at).toBeNull()
  })

  it('rejects unsafe values', async () => {
    const insert = (cols: string, vals: string) =>
      query(pool, user(U.staffA), `insert into public.admission_programs (tenant_id, name, ${cols}) values ($1, 'Okay', ${vals})`, [tenantA])
    await expect(insert('code', `'bad code!'`)).rejects.toMatchObject({ code: '23514' })
    await expect(insert('code, application_url', `'OK1', 'http://insecure.example'`)).rejects.toMatchObject({ code: '23514' })
    await expect(insert('code, application_url', `'OK1', 'javascript:alert(1)'`)).rejects.toMatchObject({ code: '23514' })
    await expect(insert('code, tuition_amount, tuition_currency, tuition_period', `'OK1', 10, 'usd', 'year'`)).rejects.toMatchObject({ code: '23514' })
    await expect(insert('code, tuition_amount', `'OK2', 100`)).rejects.toMatchObject({ code: '23514' }) // amount without currency/period
    await expect(insert('code, department_id', `'OK3', gen_random_uuid()`)).rejects.toMatchObject({ code: '23503' })
  })
})

describe('inquiries (leads) from visitors', () => {
  it('an anonymous visitor sends an inquiry with consent and gets a reference', async () => {
    const r = await submit(visitor(U.visitor1), 'uni-a')
    expect(r.reference).toBe('L-00001')
    const lead = (await pool.query(`select * from public.admission_leads where reference = 'L-00001' and tenant_id = $1`, [tenantA])).rows[0]
    expect(lead).toMatchObject({ source: 'form', stage: 'new', consent_version: '1', consent_text: CONSENT, submitted_by: U.visitor1, program_id: programA })
    expect(lead.consent_at).not.toBeNull()
  })

  it('refuses without a session, without consent text or contact, and with foreign or draft programs', async () => {
    await expect(query(pool, anon, `select public.admissions_submit_lead('uni-a', 'A B', 'a@b.test', null, null, null, null, null, 'en', '1', $1, null)`, [CONSENT])).rejects.toMatchObject({ code: '42501' })
    await expect(submit(visitor(U.visitor2), 'uni-a', { consent: 'ok' })).rejects.toMatchObject({ code: '23514' })
    await expect(submit(visitor(U.visitor2), 'uni-a', { email: null, phone: null })).rejects.toMatchObject({ code: '23514' })
    await expect(submit(visitor(U.visitor2), 'uni-a', { program: programB })).rejects.toMatchObject({ code: '22023' })
    await expect(submit(visitor(U.visitor2), 'uni-a', { program: draftProgramA })).rejects.toMatchObject({ code: '22023' })
    await expect(submit(visitor(U.visitor2), 'uni-b')).rejects.toMatchObject({ code: '42501' }) // uni-b has not opened its page
  })

  it('limits each visitor to 3 inquiries per university per day', async () => {
    await submit(visitor(U.visitor1), 'uni-a', { program: null, phone: '+249 912 000 000', email: null })
    await submit(visitor(U.visitor1), 'uni-a')
    await expect(submit(visitor(U.visitor1), 'uni-a')).rejects.toMatchObject({ code: '54000' })
  })

  it('leads are visible only to staff with leads.read in that university', async () => {
    const count = async (actor: Actor) => (await one(actor, `select count(*)::int as n from public.admission_leads`)).n
    expect(await count(user(U.staffA))).toBe(3)
    expect(await count(user(U.ownerA))).toBe(3)
    for (const actor of [visitor(U.visitor1), user(U.studentA), user(U.staffB), user(U.ownerB)]) expect(await count(actor)).toBe(0)
    await expect(query(pool, anon, `select count(*) from public.admission_leads`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, visitor(U.visitor1), `update public.admission_leads set stage = 'enrolled'`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('staff pipeline', () => {
  let leadId: string

  it('moves a lead, assigns it to someone who can read leads, and logs each change', async () => {
    leadId = (await pool.query(`select id from public.admission_leads where reference = 'L-00001' and tenant_id = $1`, [tenantA])).rows[0].id
    const sql = `select public.admissions_update_lead($1, $2, $3, $4, $5)`
    await expect(query(pool, user(U.studentA), sql, [leadId, 'contacted', null, null, programA])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.staffB), sql, [leadId, 'contacted', null, null, programA])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.staffA), sql, [leadId, 'contacted', null, U.studentA, programA])).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.staffA), sql, [leadId, 'contacted', null, U.staffB, programA])).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.staffA), sql, [leadId, 'nonsense', null, null, programA])).rejects.toMatchObject({ code: '23514' })
    await committed(user(U.staffA), sql, [leadId, 'contacted', null, U.staffA, programA])
    await committed(user(U.staffA), sql, [leadId, 'lost', 'Chose another university', U.staffA, programA])
    const kinds = (await query(pool, user(U.staffA), `select kind, from_value, to_value from public.admission_lead_events where lead_id = $1 order by id`, [leadId])).rows
    expect(kinds).toEqual([
      { kind: 'created', from_value: null, to_value: 'form' },
      { kind: 'stage', from_value: 'new', to_value: 'contacted' },
      { kind: 'assigned', from_value: null, to_value: U.staffA },
      { kind: 'stage', from_value: 'contacted', to_value: 'lost' },
    ])
    expect((await one(user(U.staffA), `select lost_reason from public.admission_leads where id = $1`, [leadId])).lost_reason).toBe('Chose another university')
  })

  it('notes are for staff only', async () => {
    await expect(query(pool, user(U.studentA), `select public.admissions_add_note($1, 'x')`, [leadId])).rejects.toMatchObject({ code: '42501' })
    await committed(user(U.staffA), `select public.admissions_add_note($1, 'Called, will apply next year')`, [leadId])
    expect((await query(pool, user(U.staffA), `select body from public.admission_lead_notes where lead_id = $1`, [leadId])).rows).toHaveLength(1)
    expect((await query(pool, user(U.staffB), `select body from public.admission_lead_notes`)).rows).toHaveLength(0)
    expect((await query(pool, visitor(U.visitor1), `select body from public.admission_lead_notes`)).rows).toHaveLength(0)
  })

  it('staff can record an inquiry received in person, with a consent note', async () => {
    const sql = `select public.admissions_create_lead('uni-a', 'Omar Ali', null, '+249 900 000 001', null, null, null, null, 'ar', $1) as r`
    await expect(query(pool, user(U.staffA), sql, ['ok'])).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.studentA), sql, ['Agreed by phone on 2026-11-24'])).rejects.toMatchObject({ code: '42501' })
    const r = (await committed(user(U.staffA), sql, ['Agreed by phone on 2026-11-24'])).r
    expect(r.reference).toBe('L-00004')
    expect(await one(user(U.staffA), `select source, consent_version from public.admission_leads where id = $1`, [r.id])).toEqual({ source: 'manual', consent_version: 'staff-recorded' })
  })

  it('deleting a lead erases it with its notes and history; the audit log keeps no personal data', async () => {
    await expect(query(pool, user(U.studentA), `select public.admissions_delete_lead($1)`, [leadId])).rejects.toMatchObject({ code: '42501' })
    await committed(user(U.staffA), `select public.admissions_delete_lead($1)`, [leadId])
    for (const table of ['admission_leads', 'admission_lead_notes', 'admission_lead_events']) {
      const col = table === 'admission_leads' ? 'id' : 'lead_id'
      expect((await pool.query(`select count(*)::int as n from public.${table} where ${col} = $1`, [leadId])).rows[0].n).toBe(0)
    }
    const audit = (await pool.query(`select action, metadata from public.audit_logs where target_id = $1`, [leadId])).rows
    expect(audit).toEqual([{ action: 'admission_leads.delete', metadata: { reference: 'L-00001' } }])
    const leak = (await pool.query(`select count(*)::int as n from public.audit_logs where metadata::text ilike any (array['%amal%', '%+249%', '%Called, will apply%'])`)).rows[0].n
    expect(leak).toBe(0)
  })

  it('analytics count stored leads only, for leads.read in that university', async () => {
    const a = (await one(user(U.staffA), `select public.admissions_analytics('uni-a') as r`)).r
    expect(a).toMatchObject({ total: 3, open: 3, by_source: { form: 2, manual: 1 }, by_stage: { new: 3 } })
    expect(a.weekly).toHaveLength(12)
    expect(a.weekly.at(-1).count).toBe(3)
    await expect(query(pool, user(U.staffB), `select public.admissions_analytics('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.studentA), `select public.admissions_analytics('uni-a')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('assignees are people who can read leads', async () => {
    const people = (await one(user(U.staffA), `select public.admissions_assignees('uni-a') as r`)).r.map((p: { user_id: string }) => p.user_id).sort()
    expect(people).toEqual([U.ownerA, U.staffA].sort())
  })
})

describe('admissions assistant', () => {
  let conversation: string

  it('is off until assistant admins turn it on (admissions staff alone cannot)', async () => {
    await expect(query(pool, visitor(U.visitor1), `select public.admissions_begin_turn('uni-a', null, 'What are the fees?')`)).rejects.toMatchObject({ code: '55000' })
    await expect(query(pool, user(U.staffA), `select public.admissions_update_assistant('uni-a', true, null, 5, 2)`)).rejects.toMatchObject({ code: '42501' })
    await committed(user(U.ownerA), `select public.admissions_update_assistant('uni-a', true, 'Be welcoming.', 0.05, 2)`)
  })

  it('a visitor starts an admissions conversation that only they can read', async () => {
    const r = (await committed(visitor(U.visitor1), `select public.admissions_begin_turn('uni-a', null, 'What are the fees?') as r`)).r
    expect(r).toMatchObject({ history: [], instructions: 'Be welcoming.', support_email: 'admissions@uni-a.example' })
    conversation = r.conversation_id
    expect((await one(visitor(U.visitor1), `select agent from public.assistant_conversations where id = $1`, [conversation])).agent).toBe('admissions')
    for (const other of [visitor(U.visitor2), user(U.ownerA), user(U.staffA)]) {
      expect((await query(pool, other, `select id from public.assistant_messages where conversation_id = $1`, [conversation])).rows).toHaveLength(0)
    }
    await expect(query(pool, visitor(U.visitor2), `select public.admissions_begin_turn('uni-a', $1, 'Continue')`, [conversation])).rejects.toMatchObject({ code: 'P0002' })
  })

  it('agents stay separate: student functions cannot continue an admissions conversation', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`select public.assistant_update_settings('uni-a', true, null, 10)`)
      // Even with the student assistant on, an admissions conversation is not a student conversation.
      await expect(c.query(`select public.assistant_begin_turn('uni-a', $1, 'Hello there')`, [conversation])).rejects.toMatchObject({ code: 'P0002' })
    })
    // …and the admissions function cannot continue a student conversation.
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`select public.assistant_update_settings('uni-a', true, null, 10)`)
      const student = (await c.query(`select public.assistant_begin_turn('uni-a', null, 'Hello there') as r`)).rows[0].r.conversation_id
      await expect(c.query(`select public.admissions_begin_turn('uni-a', $1, 'Continue')`, [student])).rejects.toMatchObject({ code: 'P0002' })
    })
  })

  it('the visitor stores the answer; usage is booked to the admissions agent and its budget', async () => {
    await committed(visitor(U.visitor1), `select public.assistant_complete_turn($1, 'Tuition is 1,200 USD per semester. [1]', 'answered', '[]', '[]', 'claude-opus-5-5', $2, 900)`, [
      conversation,
      JSON.stringify({ input_tokens: 2000, output_tokens: 100, cost_usd: 0.06 }),
    ])
    const ev = (await pool.query(`select feature, user_id from public.ai_usage_events where tenant_id = $1`, [tenantA])).rows
    expect(ev).toEqual([{ feature: 'admissions_agent', user_id: U.visitor1 }])
    // The student assistant's budget is not touched by admissions spend.
    expect((await pool.query(`select app.assistant_month_cost($1) as c`, [tenantA])).rows[0].c).toBe('0')
    await expect(query(pool, visitor(U.visitor2), `select public.admissions_begin_turn('uni-a', null, 'Any scholarships?')`)).rejects.toMatchObject({ code: '53400' })
  })

  it('limits questions per visitor per day', async () => {
    await committed(user(U.ownerA), `select public.admissions_update_assistant('uni-a', true, null, 50, 2)`)
    await committed(visitor(U.visitor1), `select public.admissions_begin_turn('uni-a', $1, 'And the deadline?')`, [conversation])
    await expect(query(pool, visitor(U.visitor1), `select public.admissions_begin_turn('uni-a', $1, 'And housing?')`, [conversation])).rejects.toMatchObject({ code: '54000' })
    await committed(visitor(U.visitor2), `select public.admissions_begin_turn('uni-a', null, 'Any scholarships?')`)
  })

  it('an inquiry can come from the assistant conversation of the same visitor only', async () => {
    await expect(submit(visitor(U.visitor2), 'uni-a', { conversation })).rejects.toMatchObject({ code: '22023' })
    await pool.query(`delete from public.admission_leads where submitted_by = $1`, [U.visitor1]) // reset the daily inquiry limit
    const r = await submit(visitor(U.visitor1), 'uni-a', { conversation })
    expect((await pool.query(`select source, conversation_id from public.admission_leads where reference = $1`, [r.reference])).rows[0]).toEqual({ source: 'assistant', conversation_id: conversation })
  })

  it('retrieval returns only published public documents', async () => {
    const ingest = async (title: string, visibility: string, content: string) => {
      const begun = await committed(user(U.ownerA), `select public.knowledge_begin_upload('uni-a', null, 'f.pdf', 'application/pdf', 1000, $1) as r`, [JSON.stringify({ title, visibility })])
      const { document_id, version_id } = begun.r
      await asCommitted(pool, user(U.ownerA), async (c) => {
        await c.query(`select public.knowledge_set_version_status($1, 'queued', null, $2)`, [version_id, 'a'.repeat(64)])
        await c.query(`select public.knowledge_set_version_status($1, 'processing')`, [version_id])
        await c.query(`select public.knowledge_complete_version($1, $2, $3)`, [version_id, JSON.stringify({ page_count: 1, char_count: 100 }), JSON.stringify([{ content, page_from: 1, page_to: 1 }])])
        await c.query(`select public.knowledge_set_published($1, true)`, [document_id])
      })
    }
    await ingest('Admissions Guide', 'public', 'Scholarships cover up to half of the tuition for top applicants.')
    await ingest('Staff Handbook', 'staff', 'Scholarships budget is decided by the finance committee in secret.')
    await ingest('Student Rules', 'members', 'Scholarships for current students require a GPA of 3.5.')
    const hits = (await one(visitor(U.visitor2), `select public.admissions_search('uni-a', 'scholarships', 6) as r`)).r
    expect(hits.map((h: { title: string }) => h.title)).toEqual(['Admissions Guide'])
    await expect(query(pool, visitor(U.visitor2), `select public.admissions_search('uni-b', 'scholarships', 6)`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.admissions_search('uni-a', 'scholarships', 6)`)).rejects.toMatchObject({ code: '42501' })
  })

  it('the student assistant usage summary counts student conversations only', async () => {
    const s = (await one(user(U.ownerA), `select public.assistant_usage_summary('uni-a') as r`)).r
    expect(s).toMatchObject({ questions: 0, cost_usd: 0 })
    const a = (await one(user(U.staffA), `select public.admissions_analytics('uni-a') as r`)).r.assistant
    expect(a).toMatchObject({ questions: 3, answered: 1, visitors: 2 })
    expect(Number(a.cost_usd)).toBeCloseTo(0.06, 6)
  })
})
