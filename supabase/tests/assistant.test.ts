import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, asCommitted, createTestDatabase, query, user } from './harness'

/**
 * Phase 5 (student assistant) database tests: gates (permission, feature, switch, budget),
 * conversation privacy between students and across universities, usage accounting and the
 * monthly budget, feedback, and the settings/usage functions for assistant admins.
 */

const U = {
  ownerA: '30000000-0000-4000-8000-00000000000a',
  studentA: '30000000-0000-4000-8000-0000000000a3',
  student2A: '30000000-0000-4000-8000-0000000000a4',
  ownerB: '30000000-0000-4000-8000-00000000000b',
  studentB: '30000000-0000-4000-8000-0000000000b3',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string

async function addMember(tenant: string, userId: string, roleKey: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(
    `insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`,
    [tenant, rows[0]!.id, roleKey],
  )
}

const begin = (actor: string, slug: string, question: string, conversation: string | null = null) =>
  asCommitted(pool, user(actor), (c) => c.query(`select public.assistant_begin_turn($1, $2, $3) as r`, [slug, conversation, question])).then((r) => r.rows[0].r)

const complete = (actor: string, conversation: string, status = 'answered', costUsd = 0.01) =>
  asCommitted(pool, user(actor), (c) =>
    c.query(`select public.assistant_complete_turn($1, $2, $3, $4, $5, $6, $7, $8) as id`, [
      conversation,
      'The tuition fee is 1200 per semester.',
      status,
      JSON.stringify([{ index: 1, chunk_id: 1, title: 'Fees' }]),
      JSON.stringify([{ chunk_id: 1, document_id: 'x', title: 'Fees' }]),
      'claude-opus-5-5',
      JSON.stringify({ input_tokens: 1200, output_tokens: 80, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: costUsd }),
      950,
    ]),
  ).then((r) => r.rows[0].id as string)

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.ownerA])).rows[0].id
  const tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  await addMember(tenantA, U.studentA, 'student')
  await addMember(tenantA, U.student2A, 'student')
  await addMember(tenantB, U.studentB, 'student')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('gates', () => {
  it('the assistant is off until the university turns it on', async () => {
    const status = (await query(pool, user(U.studentA), `select public.assistant_status('uni-a') as s`)).rows[0].s
    expect(status).toEqual({ can_use: true, feature: true, enabled: false, within_budget: false })
    await expect(query(pool, user(U.studentA), `select public.assistant_begin_turn('uni-a', null, 'When is registration?')`)).rejects.toMatchObject({ code: '55000' })
  })

  it('only assistant admins change settings', async () => {
    await expect(query(pool, user(U.studentA), `select public.assistant_update_settings('uni-a', true, null, 10)`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.ownerB), `select public.assistant_update_settings('uni-a', true, null, 10)`)).rejects.toMatchObject({ code: '42501' })
    await asCommitted(pool, user(U.ownerA), (c) => c.query(`select public.assistant_update_settings('uni-a', true, 'Answer politely.', 1)`))
    const status = (await query(pool, user(U.studentA), `select public.assistant_status('uni-a') as s`)).rows[0].s
    expect(status).toMatchObject({ enabled: true, within_budget: true })
    await expect(query(pool, user(U.ownerA), `select public.assistant_update_settings('uni-a', true, $1, 1)`, ['x'.repeat(2001)])).rejects.toMatchObject({ code: '23514' })
  })

  it('non-members, other universities and empty questions are refused', async () => {
    await expect(query(pool, user(U.studentB), `select public.assistant_begin_turn('uni-a', null, 'Hello there')`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.studentA), `select public.assistant_begin_turn('uni-a', null, ' ')`)).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.studentA), `select public.assistant_begin_turn('uni-a', null, $1)`, ['x'.repeat(2001)])).rejects.toMatchObject({ code: '22023' })
  })

  it('turning the feature off closes the assistant', async () => {
    await as(pool, user(U.studentA), async (c) => {
      await c.query(`reset role`)
      await c.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'student_assistant'`, [tenantA])
      await c.query(`set local role authenticated`)
      await expect(c.query(`select public.assistant_begin_turn('uni-a', null, 'Hello there')`)).rejects.toMatchObject({ code: '42501' })
    })
  })
})

describe('conversations', () => {
  let conversation: string

  it('a turn stores the question and returns history, instructions and ids', async () => {
    await pool.query(`update public.tenant_settings set support_email = 'help@uni-a.example' where tenant_id = $1`, [tenantA])
    const first = await begin(U.studentA, 'uni-a', 'How much is the tuition fee?')
    expect(first).toMatchObject({ history: [], instructions: 'Answer politely.', support_email: 'help@uni-a.example' })
    conversation = first.conversation_id
    await complete(U.studentA, conversation)
    const second = await begin(U.studentA, 'uni-a', 'And when do I pay it?', conversation)
    expect(second.history.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
  })

  it('conversations are private: other students, owners and other universities see nothing', async () => {
    const mine = await query(pool, user(U.studentA), `select count(*)::int as n from public.assistant_messages`)
    expect(mine.rows[0].n).toBeGreaterThanOrEqual(3)
    for (const other of [U.student2A, U.ownerA, U.studentB]) {
      expect((await query(pool, user(other), `select count(*)::int as n from public.assistant_messages`)).rows[0].n).toBe(0)
      expect((await query(pool, user(other), `select count(*)::int as n from public.assistant_conversations`)).rows[0].n).toBe(0)
    }
    await expect(begin(U.student2A, 'uni-a', 'Continue this', conversation)).rejects.toMatchObject({ code: 'P0002' })
    await expect(complete(U.student2A, conversation)).rejects.toMatchObject({ code: '42501' })
  })

  it('no direct writes through the API', async () => {
    await expect(query(pool, user(U.studentA), `insert into public.ai_usage_events (tenant_id, feature, model) values ($1, 'x_feature', 'm1')`, [tenantA])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.studentA), `delete from public.ai_usage_events`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.studentA), `update public.assistant_messages set content = 'x'`)).rejects.toMatchObject({ code: '42501' })
  })

  it('feedback only on your own assistant answers', async () => {
    const answer = await complete(U.studentA, conversation)
    await asCommitted(pool, user(U.studentA), (c) => c.query(`select public.assistant_set_feedback($1, -1::smallint, 'Missing the deadline')`, [answer]))
    await asCommitted(pool, user(U.studentA), (c) => c.query(`select public.assistant_set_feedback($1, 1::smallint, null)`, [answer]))
    expect((await pool.query(`select rating from public.assistant_feedback where message_id = $1`, [answer])).rows[0].rating).toBe(1)
    await expect(query(pool, user(U.student2A), `select public.assistant_set_feedback($1, 1::smallint, null)`, [answer])).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.studentA), `select public.assistant_set_feedback($1, 2::smallint, null)`, [answer])).rejects.toMatchObject({ code: '23514' })
  })

  it('usage is recorded per call and the monthly budget stops new turns', async () => {
    const summary = (await query(pool, user(U.ownerA), `select public.assistant_usage_summary('uni-a') as s`)).rows[0].s
    expect(summary).toMatchObject({ answered: 2, helpful: 1 })
    expect(Number(summary.cost_usd)).toBeCloseTo(0.02, 5)
    await expect(query(pool, user(U.studentA), `select public.assistant_usage_summary('uni-a')`)).rejects.toMatchObject({ code: '42501' })

    // Budget 1.00 USD: one expensive call exhausts it.
    const turn = await begin(U.studentA, 'uni-a', 'One more question please')
    await complete(U.studentA, turn.conversation_id, 'answered', 1.5)
    await expect(begin(U.studentA, 'uni-a', 'Another question')).rejects.toMatchObject({ code: '53400' })
    const status = (await query(pool, user(U.studentA), `select public.assistant_status('uni-a') as s`)).rows[0].s
    expect(status.within_budget).toBe(false)
  })
})
