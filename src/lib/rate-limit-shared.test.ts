// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ rpc }) }))
vi.mock('@/lib/supabase/config', () => ({ isSupabaseConfigured: () => true }))

const { createRateLimiter, rateLimitBucket } = await import('./rate-limit-shared')
const SECRET = 'x'.repeat(40)

afterEach(() => {
  vi.unstubAllEnvs()
  rpc.mockReset()
})

describe('shared rate limiter', () => {
  it('buckets are keyed hashes: stable, private, and different per secret and name', () => {
    const a = rateLimitBucket(SECRET, 'auth.email', 'login:email:someone@uni.example')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(rateLimitBucket(SECRET, 'auth.email', 'login:email:someone@uni.example'))
    expect(a).not.toContain('someone')
    expect(rateLimitBucket('y'.repeat(40), 'auth.email', 'login:email:someone@uni.example')).not.toBe(a)
    expect(rateLimitBucket(SECRET, 'auth.ip', 'login:email:someone@uni.example')).not.toBe(a)
  })

  it('uses the database when the secret is set, sending only the hash', async () => {
    vi.stubEnv('RATE_LIMIT_SECRET', SECRET)
    rpc.mockResolvedValue({ data: { allowed: false, remaining: 0, retry_after_ms: 1200 }, error: null })
    const limiter = createRateLimiter('contact.ip', { limit: 5, windowMs: 3_600_000 })
    expect(await limiter.check('inquiry:203.0.113.7')).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1200 })
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', { p_bucket: rateLimitBucket(SECRET, 'contact.ip', 'inquiry:203.0.113.7'), p_limit: 5, p_window_seconds: 3600 })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('203.0.113.7')
  })

  it('falls back to memory without a secret, in preview, or when the database fails', async () => {
    const limiter = createRateLimiter('contact.ip', { limit: 2, windowMs: 60_000 })
    const results = [await limiter.check('k'), await limiter.check('k'), await limiter.check('k')]
    expect(results.map((r) => r.allowed)).toEqual([true, true, false])
    expect(rpc).not.toHaveBeenCalled()

    vi.stubEnv('RATE_LIMIT_SECRET', SECRET)
    vi.stubEnv('UNIAGENT_UI_PREVIEW', 'true')
    expect((await createRateLimiter('a.b', { limit: 1, windowMs: 1000 }).check('k')).allowed).toBe(true)
    expect(rpc).not.toHaveBeenCalled()

    vi.stubEnv('UNIAGENT_UI_PREVIEW', 'false')
    rpc.mockResolvedValue({ data: null, error: { code: '08006' } })
    const failing = createRateLimiter('a.c', { limit: 1, windowMs: 60_000 })
    expect((await failing.check('k')).allowed).toBe(true)
    expect((await failing.check('k')).allowed).toBe(false) // memory still limits
  })

  it('rejects odd names and short secrets', () => {
    expect(() => createRateLimiter('Bad Name', { limit: 1, windowMs: 1000 })).toThrow()
  })
})
