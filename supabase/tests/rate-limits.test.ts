import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, asCommitted, createTestDatabase, query, user } from './harness'

/** Phase 16: the shared rate limiter (migration 22). */

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
const bucket = (c: string) => c.repeat(64)
const hit = (b: string, limit = 3, windowSeconds = 600) =>
  asCommitted(pool, anon, (c) => c.query(`select public.rate_limit_hit($1, $2, $3) as r`, [b, limit, windowSeconds])).then((r) => r.rows[0].r)

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('shared rate limits', () => {
  it('counts per bucket and window, for callers without a session too', async () => {
    expect(await hit(bucket('a'))).toEqual({ allowed: true, remaining: 2, retry_after_ms: 0 })
    await hit(bucket('a'))
    expect(await hit(bucket('a'))).toMatchObject({ allowed: true, remaining: 0 })
    const refused = await hit(bucket('a'))
    expect(refused.allowed).toBe(false)
    expect(refused.retry_after_ms).toBeGreaterThan(0)
    expect(refused.retry_after_ms).toBeLessThanOrEqual(600_000)
    expect(await hit(bucket('b'))).toMatchObject({ allowed: true, remaining: 2 }) // another bucket
  })

  it('refuses anything but a hash, and bounds the limit and window', async () => {
    for (const [b, limit, w] of [
      ['victim@example.com', 3, 600],
      [bucket('A'), 3, 600],
      [bucket('c'), 0, 600],
      [bucket('c'), 3, 0],
      [bucket('c'), 3, 90_000],
    ] as const)
      await expect(hit(b, limit, w)).rejects.toMatchObject({ code: '22023' })
  })

  it('the counters are not readable or writable through the API', async () => {
    for (const actor of [anon, user('96000000-0000-4000-8000-000000000001')]) {
      await expect(query(pool, actor, `select * from app.rate_limit_hits`)).rejects.toMatchObject({ code: '42501' })
      await expect(query(pool, actor, `delete from app.rate_limit_hits`)).rejects.toMatchObject({ code: '42501' })
    }
    const stored = (await pool.query(`select bucket from app.rate_limit_hits`)).rows.map((r) => r.bucket)
    expect(stored.every((b: string) => /^[0-9a-f]{64}$/.test(b))).toBe(true)
  })
})
