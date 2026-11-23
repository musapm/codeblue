import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user, type Actor } from './harness'

/**
 * Phase 9 (academic assistant) database tests: the Faculty member role; courses and who
 * manages them; enrollment with codes (and its brute-force limit); course materials in the
 * knowledge pipeline (readable only inside the course, never in the general assistant);
 * per-course enablement of the study tools; the generation gate (budget, daily limit);
 * private study aids with hidden quiz answers; grading; progress; class figures that never
 * reveal one student's results; and other universities.
 */

const U = {
  owner: '80000000-0000-4000-8000-00000000000a',
  manager: '80000000-0000-4000-8000-0000000000a1', // academic_affairs: academic.manage
  f1: '80000000-0000-4000-8000-0000000000a2', // faculty, instructor of CS101
  f2: '80000000-0000-4000-8000-0000000000a3', // faculty, not teaching CS101
  registrar: '80000000-0000-4000-8000-0000000000a4', // staff without academic access
  deptAdmin: '80000000-0000-4000-8000-0000000000a5', // knowledge.manage, academic.use, no academic.manage
  s1: '80000000-0000-4000-8000-0000000000b1',
  s2: '80000000-0000-4000-8000-0000000000b2',
  s3: '80000000-0000-4000-8000-0000000000b3',
  s4: '80000000-0000-4000-8000-0000000000b4',
  s5: '80000000-0000-4000-8000-0000000000b5',
  s6: '80000000-0000-4000-8000-0000000000b6', // never enrolled in CS101
  ownerB: '80000000-0000-4000-8000-00000000000b',
  studentB: '80000000-0000-4000-8000-0000000000c1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
let cs101: string
let code: string
let notes: { id: string; version: string; path: string }
let draftNotes: { id: string; version: string; path: string }
let quizId: string

const rpc = async (actor: Actor, sql: string, params: unknown[] = []) => (await query(pool, actor, `select ${sql} as r`, params)).rows[0].r
const run = (actor: Actor, sql: string, params: unknown[] = []) => asCommitted(pool, actor, (c) => c.query(`select ${sql} as r`, params)).then((r) => r.rows[0].r)
const count = async (actor: Actor, table: string, where = 'true', params: unknown[] = []) =>
  (await query(pool, actor, `select count(*)::int as n from ${table} where ${where}`, params)).rows[0].n as number

async function addMember(tenant: string, userId: string, roleKey: string, departmentId?: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`, [tenant, rows[0]!.id, roleKey])
  if (departmentId) await pool.query(`insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`, [tenant, rows[0]!.id, departmentId])
}

/** Upload and process a course material through the real pipeline, as `actor`. */
async function material(actor: string, course: string, title: string, chunks: Record<string, unknown>[], publish = true) {
  const begun = await run(user(actor), `public.academic_begin_upload($1, null, 'notes.pdf', 'application/pdf', 1000, $2)`, [course, JSON.stringify({ title })])
  await asCommitted(pool, user(actor), async (c) => {
    await c.query(`select public.knowledge_set_version_status($1, 'queued', null, $2)`, [begun.version_id, 'b'.repeat(64)])
    await c.query(`select public.knowledge_set_version_status($1, 'processing')`, [begun.version_id])
    await c.query(`select public.knowledge_complete_version($1, $2, $3)`, [begun.version_id, JSON.stringify({ page_count: 3, char_count: 500 }), JSON.stringify(chunks)])
    if (publish) await c.query(`select public.academic_set_material_published($1, true)`, [begun.document_id])
  })
  return { id: begun.document_id as string, version: begun.version_id as string, path: begun.storage_path as string }
}

const usage = { input_tokens: 9000, output_tokens: 1200, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.06 }
const quiz = (n = 2) => ({
  content: {
    questions: Array.from({ length: n }, (_, k) => ({ question: `Question ${k + 1}?`, options: ['A', 'B', 'C', 'D'], source: { m: 0, pages: '1' } })),
  },
  answer_key: { answers: Array.from({ length: n }, (_, k) => ({ correct: k % 4, explanation: `Because ${k + 1}.` })) },
})
const save = (actor: string, kind: string, content: unknown, answerKey: unknown, sources?: unknown[]) =>
  run(user(actor), `public.academic_save_item($1, $2, 'Practice', 'en', $3, $4, $5, 'claude-opus-5-5', $6)`, [
    cs101,
    kind,
    JSON.stringify(content),
    answerKey === null ? null : JSON.stringify(answerKey),
    JSON.stringify(sources ?? [{ document_id: notes.id, version_no: 1, title: 'Week 1 notes' }]),
    JSON.stringify(usage),
  ])

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  await pool.query(`update public.profiles set full_name = 'Dr Faisal' where id = $1`, [U.f1])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  const dept = (await pool.query(`insert into public.departments (tenant_id, name, slug) values ($1, 'Computing', 'computing') returning id`, [tenantA])).rows[0].id
  await addMember(tenantA, U.manager, 'academic_affairs')
  await addMember(tenantA, U.f1, 'faculty')
  await addMember(tenantA, U.f2, 'faculty')
  await addMember(tenantA, U.registrar, 'registrar')
  await addMember(tenantA, U.deptAdmin, 'department_admin', dept)
  for (const s of [U.s1, U.s2, U.s3, U.s4, U.s5, U.s6]) await addMember(tenantA, s, 'student')
  await addMember(tenantB, U.studentB, 'student')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the Faculty member role', () => {
  it('exists in every university and gives academic access without managing courses', async () => {
    const perms = (await pool.query(`select array_agg(rp.permission_key order by rp.permission_key) as p from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = $1 and r.key = 'faculty'`, [tenantA])).rows[0].p
    expect(perms).toContain('academic.use')
    expect(perms).not.toContain('academic.manage')
    expect((await pool.query(`select count(*)::int as n from public.roles where key = 'faculty' and is_system`)).rows[0].n).toBe(2)
  })
})

describe('courses and teaching staff', () => {
  it('only academic managers create courses; codes are unique per term', async () => {
    const create = (actor: string, c = 'cs101', term = 'Fall 2026') => run(user(actor), `public.academic_create_course('uni-a', $1, 'Introduction to Computing', null, null, null, $2)`, [c, term])
    for (const actor of [U.f1, U.registrar, U.s1, U.deptAdmin, U.ownerB]) await expect(create(actor)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.academic_create_course('uni-a', 'X1', 'Title', null, null, null, null)`)).rejects.toMatchObject({ code: '42501' })
    cs101 = await create(U.manager)
    await expect(create(U.manager)).rejects.toMatchObject({ code: '23505' })
    await create(U.manager, 'CS101', 'Spring 2027') // same code, another term
    const row = (await pool.query(`select code, status, ai_enabled, join_code from public.courses where id = $1`, [cs101])).rows[0]
    expect(row).toMatchObject({ code: 'CS101', status: 'draft', ai_enabled: false })
    expect(row.join_code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
    code = row.join_code
    expect((await pool.query(`select monthly_budget_usd::float as b, daily_limit from public.academic_settings where tenant_id = $1`, [tenantA])).rows[0]).toEqual({ b: 20, daily_limit: 20 })
  })

  it('instructors are assigned by e-mail, only if they have academic access', async () => {
    const add = (actor: string, email: string) => run(user(actor), `public.academic_add_instructor($1, $2)`, [cs101, email])
    await expect(add(U.f1, `${U.f2}@test.example`)).rejects.toMatchObject({ code: '42501' })
    await expect(add(U.manager, `${U.registrar}@test.example`)).rejects.toMatchObject({ code: 'P0002' }) // no academic access
    await expect(add(U.manager, 'nobody@test.example')).rejects.toMatchObject({ code: 'P0002' })
    await expect(add(U.manager, `${U.studentB}@test.example`)).rejects.toMatchObject({ code: 'P0002' }) // another university
    expect(await add(U.manager, `${U.f1.toUpperCase()}@TEST.EXAMPLE`)).toEqual({ user_id: U.f1, name: 'Dr Faisal' })
  })

  it('who sees a course: its teachers and academic managers; students only once active and enrolled', async () => {
    const sees = (actor: string) => count(user(actor), 'public.courses', 'id = $1', [cs101])
    expect(await sees(U.f1)).toBe(1)
    expect(await sees(U.manager)).toBe(1)
    expect(await sees(U.owner)).toBe(1)
    for (const actor of [U.f2, U.s1, U.registrar, U.deptAdmin, U.ownerB]) expect(await sees(actor)).toBe(0)
    // The join code is not a readable column, not even for teachers.
    await expect(query(pool, user(U.f1), `select join_code from public.courses`)).rejects.toMatchObject({ code: '42501' })
    expect((await rpc(user(U.f1), `public.academic_course_admin($1)`, [cs101])).join_code).toBe(code)
    await expect(rpc(user(U.s1), `public.academic_course_admin($1)`, [cs101])).rejects.toMatchObject({ code: '42501' })
  })

  it('course details are for academic managers; study-tool settings for its teachers', async () => {
    await expect(run(user(U.f1), `public.academic_update_course($1, 'CS101', 'Intro', null, null, null, 'Fall 2026', 'active')`, [cs101])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.manager), `public.academic_update_course($1, 'CS101', 'Introduction to Computing', null, null, null, 'Fall 2026', 'active')`, [cs101])
    await expect(run(user(U.f2), `public.academic_update_course_ai($1, true, true, true, true, true, null)`, [cs101])).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.manager), `public.academic_update_course($1, 'CS101', 'Intro', null, null, null, 'Fall 2026', 'paused')`, [cs101])).rejects.toMatchObject({ code: '23514' })
  })
})

describe('enrollment with a course code', () => {
  it('students join active courses with the code (spaces, dashes and case do not matter)', async () => {
    const join = (actor: string, c: string) => run(user(actor), `public.academic_join_course('uni-a', $1)`, [c])
    const pretty = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `
    expect(await join(U.s1, pretty)).toEqual({ status: 'joined', course_id: cs101 })
    expect(await join(U.s1, code)).toEqual({ status: 'already', course_id: cs101 })
    for (const s of [U.s2, U.s3, U.s4, U.s5]) await join(s, code)
    await expect(join(U.registrar, code)).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.studentB), `public.academic_join_course('uni-a', $1)`, [code])).rejects.toMatchObject({ code: '42501' })
    expect(await count(user(U.s1), 'public.courses', 'id = $1', [cs101])).toBe(1)
  })

  it('wrong codes are counted: after 10 in an hour joining is refused', async () => {
    const join = (c: string) => run(user(U.s6), `public.academic_join_course('uni-a', $1)`, [c])
    for (let k = 0; k < 10; k++) expect(await join(`WRONG${k}AA`)).toEqual({ status: 'invalid' })
    await expect(join(code)).rejects.toMatchObject({ code: '54000' })
    await pool.query(`delete from app.academic_join_failures where user_id = $1`, [U.s6])
  })

  it('teachers close joining or rotate the code', async () => {
    const newCode = await run(user(U.f1), `public.academic_set_join($1, false, true)`, [cs101])
    expect(newCode).not.toBe(code)
    expect(await run(user(U.s6), `public.academic_join_course('uni-a', $1)`, [newCode])).toEqual({ status: 'invalid' }) // closed
    await run(user(U.f1), `public.academic_set_join($1, true, false)`, [cs101])
    expect(await run(user(U.s6), `public.academic_join_course('uni-a', $1)`, [code])).toEqual({ status: 'invalid' }) // old code
    expect((await run(user(U.s6), `public.academic_join_course('uni-a', $1)`, [newCode])).status).toBe('joined')
    code = newCode
  })

  it('the roster is for teachers; students see only their own membership', async () => {
    const roster = await rpc(user(U.f1), `public.academic_course_roster($1)`, [cs101])
    expect(roster.map((r: { role: string }) => r.role).filter((r: string) => r === 'student')).toHaveLength(6)
    await expect(rpc(user(U.s1), `public.academic_course_roster($1)`, [cs101])).rejects.toMatchObject({ code: '42501' })
    expect(await count(user(U.s1), 'public.course_members')).toBe(1)
    expect(await count(user(U.f1), 'public.course_members')).toBe(7)
  })

  it('removing people: teachers remove students, students leave, nobody else', async () => {
    const remove = (actor: string, who: string) => run(user(actor), `public.academic_remove_member($1, $2)`, [cs101, who])
    await expect(remove(U.s1, U.s2)).rejects.toMatchObject({ code: '42501' })
    await expect(remove(U.f2, U.s2)).rejects.toMatchObject({ code: '42501' })
    await expect(remove(U.s1, U.f1)).rejects.toMatchObject({ code: '42501' })
    await remove(U.s6, U.s6) // leaves
    expect(await count(user(U.s6), 'public.courses', 'id = $1', [cs101])).toBe(0)
  })
})

describe('course materials', () => {
  it('teachers upload and process materials through the knowledge pipeline; others cannot', async () => {
    notes = await material(U.f1, cs101, 'Week 1 notes', [
      { content: 'An algorithm is a finite sequence of steps.', page_from: 1, page_to: 1, heading: 'Algorithms' },
      { content: 'Big-O notation describes growth.', page_from: 2, page_to: 2 },
    ])
    draftNotes = await material(U.f1, cs101, 'Week 2 draft', [{ content: 'Recursion calls itself.', page_from: 1, page_to: 1 }], false)
    await expect(run(user(U.f2), `public.academic_begin_upload($1, null, 'x.pdf', 'application/pdf', 10, '{"title":"Mine"}')`, [cs101])).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.s1), `public.academic_begin_upload($1, null, 'x.pdf', 'application/pdf', 10, '{"title":"Mine"}')`, [cs101])).rejects.toMatchObject({ code: '42501' })
    expect((await pool.query(`select course_id, visibility from public.knowledge_documents where id = $1`, [notes.id])).rows[0]).toEqual({ course_id: cs101, visibility: 'restricted' })
  })

  it('students read published materials of their course only; the knowledge base never shows them', async () => {
    const docs = (actor: string) => count(user(actor), 'public.knowledge_documents', 'course_id = $1', [cs101])
    expect(await docs(U.f1)).toBe(2)
    expect(await docs(U.manager)).toBe(2)
    expect(await docs(U.s1)).toBe(1) // the draft is hidden
    expect(await count(user(U.s1), 'public.knowledge_chunks', 'document_id = $1', [notes.id])).toBe(2)
    for (const actor of [U.s6, U.f2, U.deptAdmin, U.registrar, U.ownerB]) expect(await docs(actor)).toBe(0)
    await expect(run(user(U.s1), `public.academic_set_material_published($1, false)`, [notes.id])).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.f1), `public.knowledge_update_document($1, '{"visibility":"public"}')`, [notes.id])).rejects.toMatchObject({ code: '23514' })
  })

  it('the general assistant never retrieves course materials, not even for the owner', async () => {
    for (const actor of [U.owner, U.s1, U.f1]) {
      const hits = await rpc(user(actor), `public.search_knowledge('uni-a', 'algorithm steps', 8)`)
      expect(hits).toEqual([])
    }
  })

  it('storage: teachers may upload to and remove files of their course materials; students only read published ones', async () => {
    await pool.query(`insert into storage.objects (bucket_id, name) values ('tenant-documents', $1), ('tenant-documents', $2)`, [notes.path, draftNotes.path])
    const names = async (actor: string) => (await query(pool, user(actor), `select name from storage.objects where bucket_id = 'tenant-documents' order by name`)).rows.map((r) => r.name)
    expect(await names(U.s1)).toEqual([notes.path])
    expect((await names(U.f1)).sort()).toEqual([notes.path, draftNotes.path].sort())
    expect(await names(U.s6)).toEqual([])
    const del = (actor: string, path: string) => asCommitted(pool, user(actor), (c) => c.query(`delete from storage.objects where name = $1`, [path])).then((r) => r.rowCount)
    expect(await del(U.s1, notes.path)).toBe(0)
    expect(await del(U.f2, draftNotes.path)).toBe(0)
    expect(await del(U.f1, draftNotes.path)).toBe(1)
  })
})

describe('the study tools are switched on per course', () => {
  const begin = (actor: string, kind: string, docs: string[]) => rpc(user(actor), `public.academic_begin_generation($1, $2, $3::uuid[])`, [cs101, kind, docs])

  it('off until a teacher turns them on, and per tool', async () => {
    await expect(begin(U.s1, 'quiz', [notes.id])).rejects.toMatchObject({ code: '55000' })
    await run(user(U.f1), `public.academic_update_course_ai($1, true, true, false, true, true, 'Use the course terminology.')`, [cs101])
    await expect(begin(U.s1, 'quiz', [notes.id])).rejects.toMatchObject({ code: '55000' }) // quizzes off
    await run(user(U.f1), `public.academic_update_course_ai($1, true, true, true, true, true, 'Use the course terminology.')`, [cs101])
    const r = await begin(U.s1, 'quiz', [notes.id])
    expect(r.course).toMatchObject({ code: 'CS101', instructions: 'Use the course terminology.' })
    expect(r.truncated).toBe(false)
    expect(r.materials).toHaveLength(1)
    expect(r.materials[0].chunks.map((c: { content: string }) => c.content)).toEqual(['An algorithm is a finite sequence of steps.', 'Big-O notation describes growth.'])
  })

  it('students use published materials of their course; teachers may also use drafts', async () => {
    await expect(begin(U.s1, 'summary', [draftNotes.id])).rejects.toMatchObject({ code: '22023' })
    expect((await begin(U.f1, 'summary', [draftNotes.id])).materials).toHaveLength(1)
    await expect(begin(U.s1, 'summary', [notes.id, notes.id])).rejects.toMatchObject({ code: '22023' })
    await expect(begin(U.s1, 'summary', [])).rejects.toMatchObject({ code: '22023' })
    await expect(begin(U.s1, 'essay', [notes.id])).rejects.toMatchObject({ code: '22023' })
    for (const actor of [U.s6, U.f2, U.studentB, U.registrar]) await expect(begin(actor, 'summary', [notes.id])).rejects.toMatchObject({ code: '42501' })
  })

  it('long materials are cut at 120,000 characters', async () => {
    const big = await material(U.f1, cs101, 'Textbook', Array.from({ length: 16 }, (_, k) => ({ content: 'x'.repeat(8000), page_from: k + 1, page_to: k + 1 })))
    const r = await begin(U.s1, 'summary', [notes.id, big.id])
    expect(r.truncated).toBe(true)
    const chars = r.materials.flatMap((m: { chunks: { content: string }[] }) => m.chunks).reduce((n: number, c: { content: string }) => n + c.content.length, 0)
    expect(chars).toBeLessThanOrEqual(120_000)
  })

  it('the monthly budget and the daily limit per person are enforced', async () => {
    await run(user(U.manager), `public.academic_update_settings('uni-a', 0, 20)`)
    await expect(begin(U.s1, 'summary', [notes.id])).rejects.toMatchObject({ code: '53400' })
    await run(user(U.manager), `public.academic_update_settings('uni-a', 50, 2)`)
    await pool.query(`insert into public.ai_usage_events (tenant_id, user_id, feature, model, cost_usd) values ($1, $2, 'academic_agent', 'claude-opus-5-5', 0.01), ($1, $2, 'academic_agent', 'claude-opus-5-5', 0.01)`, [tenantA, U.s2])
    await expect(begin(U.s2, 'summary', [notes.id])).rejects.toMatchObject({ code: '54000' })
    await expect(run(user(U.f1), `public.academic_update_settings('uni-a', 50, 20)`)).rejects.toMatchObject({ code: '42501' })
    await run(user(U.manager), `public.academic_update_settings('uni-a', 50, 20)`)
  })
})

describe('study aids are private, and quiz answers stay in the database', () => {
  it('a student saves a quiz; usage is booked as academic_agent', async () => {
    const q = quiz(4)
    quizId = await save(U.s1, 'quiz', q.content, q.answer_key)
    const booked = (await pool.query(`select count(*)::int as n from public.ai_usage_events where user_id = $1 and feature = 'academic_agent'`, [U.s1])).rows[0].n
    expect(booked).toBe(1)
  })

  it('malformed study aids are refused', async () => {
    const q = quiz(2)
    await expect(save(U.s1, 'quiz', q.content, { answers: [{ correct: 1 }] })).rejects.toMatchObject({ code: '22023' })
    await expect(save(U.s1, 'quiz', q.content, { answers: [{ correct: 1 }, { correct: 4 }] })).rejects.toMatchObject({ code: '22023' })
    await expect(save(U.s1, 'quiz', { questions: [{ question: 'Q', options: ['A', 'B'] }] }, { answers: [{ correct: 0 }] })).rejects.toMatchObject({ code: '22023' })
    await expect(save(U.s1, 'summary', { overview: 'Text' }, { answers: [] })).rejects.toMatchObject({ code: '22023' })
    await expect(save(U.s1, 'flashcards', { cards: [] }, null)).rejects.toMatchObject({ code: '22023' })
    await expect(save(U.s1, 'summary', { overview: 'Text' }, null, [])).rejects.toMatchObject({ code: '22023' })
    await expect(save(U.s6, 'summary', { overview: 'Text' }, null)).rejects.toMatchObject({ code: '42501' })
  })

  it('nobody else sees a student’s study aids — not other students, teachers or the owner', async () => {
    expect(await count(user(U.s1), 'public.academic_items')).toBe(1)
    for (const actor of [U.s2, U.f1, U.manager, U.owner]) expect(await count(user(actor), 'public.academic_items')).toBe(0)
    await expect(query(pool, user(U.s1), `select answer_key from public.academic_items`)).rejects.toMatchObject({ code: '42501' })
    expect((await query(pool, user(U.s1), `select kind, title from public.academic_items`)).rows).toEqual([{ kind: 'quiz', title: 'Practice' }])
  })

  it('grading happens in the database and returns the answers only after an attempt', async () => {
    expect(await rpc(user(U.s1), `public.academic_quiz_review($1)`, [quizId])).toBeNull()
    const r = await run(user(U.s1), `public.academic_submit_quiz($1, $2)`, [quizId, JSON.stringify([0, 1, 0, null])])
    expect(r).toMatchObject({ score: 2, total: 4 })
    expect(r.results.map((x: { correct: boolean; answer: number }) => [x.correct, x.answer])).toEqual([
      [true, 0],
      [true, 1],
      [false, 2],
      [false, 3],
    ])
    expect(r.results[2].explanation).toBe('Because 3.')
    expect(r.results[0].document_id).toBe(notes.id)
    const review = await rpc(user(U.s1), `public.academic_quiz_review($1)`, [quizId])
    expect(review).toMatchObject({ score: 2, total: 4, attempts: 1 })
    await expect(run(user(U.s2), `public.academic_submit_quiz($1, $2)`, [quizId, JSON.stringify([0, 0, 0, 0])])).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.s1), `public.academic_submit_quiz($1, $2)`, [quizId, JSON.stringify([0, 0])])).rejects.toMatchObject({ code: '22023' })
    await expect(run(user(U.s1), `public.academic_submit_quiz($1, $2)`, [quizId, JSON.stringify([0, 0, 0, 4])])).rejects.toMatchObject({ code: '22023' })
  })

  it('progress on flashcards and study plans; only by the owner and within range', async () => {
    const cards = await save(U.s1, 'flashcards', { cards: [{ front: 'A', back: 'B' }, { front: 'C', back: 'D' }, { front: 'E', back: 'F' }] }, null)
    const progress = (actor: string, item: string, state: unknown) => run(user(actor), `public.academic_update_progress($1, $2)`, [item, JSON.stringify(state)])
    await progress(U.s1, cards, { known: [0, 2] })
    expect((await query(pool, user(U.s1), `select state from public.academic_items where id = $1`, [cards])).rows[0].state).toEqual({ known: [0, 2] })
    await expect(progress(U.s1, cards, { known: [3] })).rejects.toMatchObject({ code: '22023' })
    await expect(progress(U.s1, cards, { done: [0] })).rejects.toMatchObject({ code: '22023' })
    await expect(progress(U.s1, quizId, { known: [0] })).rejects.toMatchObject({ code: '22023' })
    await expect(progress(U.s2, cards, { known: [0] })).rejects.toMatchObject({ code: '42501' })
    await expect(run(user(U.s2), `public.academic_delete_item($1)`, [cards])).rejects.toMatchObject({ code: '42501' })
    await run(user(U.s1), `public.academic_delete_item($1)`, [cards])
  })
})

describe('class figures never reveal one student', () => {
  it('accuracy per material appears only once 5 students answered questions on it', async () => {
    const insights = () => rpc(user(U.f1), `public.academic_course_insights($1, 30)`, [cs101])
    let r = await insights()
    expect(r).toMatchObject({ min_students: 5, students: 5, attempts: 1 })
    expect(r.materials).toEqual([{ document_id: notes.id, title: 'Week 1 notes', title_ar: null, answered: 4, students: 1, accuracy: null }])
    for (const s of [U.s2, U.s3, U.s4, U.s5]) {
      const q = quiz(2)
      const id = await save(s, 'quiz', q.content, q.answer_key)
      await run(user(s), `public.academic_submit_quiz($1, $2)`, [id, JSON.stringify([0, 0])])
    }
    r = await insights()
    expect(r.materials[0]).toMatchObject({ answered: 12, students: 5, accuracy: 0.5 }) // 2/4 + 4 × 1/2 = 6/12
    expect(JSON.stringify(r)).not.toContain(U.s1)
    for (const actor of [U.s1, U.f2, U.ownerB]) await expect(rpc(user(actor), `public.academic_course_insights($1, 30)`, [cs101])).rejects.toMatchObject({ code: '42501' })
  })

  it('the academic overview is for academic managers; analytics shows activity', async () => {
    const o = await rpc(user(U.manager), `public.academic_overview('uni-a', 30)`)
    expect(o).toMatchObject({ courses: { active: 1, draft: 1 }, students: 5, generated: { quiz: 5 }, attempts: 5, people: 5, monthly_budget_usd: 50 })
    for (const actor of [U.f1, U.s1, U.registrar]) await expect(rpc(user(actor), `public.academic_overview('uni-a', 30)`)).rejects.toMatchObject({ code: '42501' })
    const analytics = await rpc(user(U.owner), `public.analytics_overview('uni-a', 30)`)
    expect(analytics.academic).toMatchObject({ generated: { quiz: 5 }, attempts: 5 })
    expect(analytics.ai.month.academic_agent).toBeGreaterThan(0)
    expect(analytics.ai.budgets.academic_agent).toBe(50)
    expect(analytics.knowledge).toMatchObject({ published: 0, unpublished: 0 }) // course materials are not counted
  })
})

describe('archived courses and other universities', () => {
  it('archiving closes the course to students, and its study tools to everyone', async () => {
    await run(user(U.manager), `public.academic_update_course($1, 'CS101', 'Introduction to Computing', null, null, null, 'Fall 2026', 'archived')`, [cs101])
    expect(await count(user(U.s1), 'public.courses', 'id = $1', [cs101])).toBe(0)
    expect(await count(user(U.s1), 'public.academic_items')).toBe(0)
    expect(await count(user(U.s1), 'public.knowledge_documents', 'course_id = $1', [cs101])).toBe(0)
    await expect(rpc(user(U.f1), `public.academic_begin_generation($1, 'summary', $2::uuid[])`, [cs101, [notes.id]])).rejects.toMatchObject({ code: '55000' })
    await expect(run(user(U.f1), `public.academic_update_course_ai($1, true, true, true, true, true, null)`, [cs101])).rejects.toMatchObject({ code: '55000' })
    expect(await count(user(U.f1), 'public.courses', 'id = $1', [cs101])).toBe(1)
  })

  it('another university sees none of it', async () => {
    for (const table of ['public.courses', 'public.course_members', 'public.academic_items', 'public.academic_quiz_attempts', 'public.academic_settings']) {
      expect(await count(user(U.ownerB), table)).toBe(0)
      expect(await count(user(U.studentB), table)).toBe(0)
    }
    await expect(query(pool, anon, `select count(*) from public.courses`)).rejects.toMatchObject({ code: '42501' })
  })

  it('study data never reaches the audit log', async () => {
    const leaked = (await pool.query(`select count(*)::int as n from public.audit_logs where metadata::text ilike any (array['%Because 3%', '%Question 1?%'])`)).rows[0].n
    expect(leaked).toBe(0)
  })
})
