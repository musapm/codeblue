/**
 * Sliding-window rate limiter.
 *
 * Phase 1 uses an in-memory store, which is per server instance. Before production
 * this must move to a shared store (Postgres, Redis/Upstash, or Cloudflare) behind the
 * same `RateLimiter` interface — tracked in TASKS.md.
 */

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number }

export interface RateLimiter {
  check(key: string): RateLimitResult
}

export type RateLimiterOptions = {
  /** Maximum requests allowed per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Upper bound on tracked keys to bound memory use. */
  maxKeys?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export function createMemoryRateLimiter({ limit, windowMs, maxKeys = 10_000, now = Date.now }: RateLimiterOptions): RateLimiter {
  if (limit < 1 || windowMs < 1) throw new Error('Rate limiter requires positive limit and window')
  const hits = new Map<string, number[]>()

  return {
    check(key) {
      const t = now()
      const windowStart = t - windowMs
      const recent = (hits.get(key) ?? []).filter((ts) => ts > windowStart)

      if (recent.length >= limit) {
        hits.set(key, recent)
        const oldest = recent[0] ?? t
        return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, oldest + windowMs - t) }
      }

      recent.push(t)
      hits.delete(key) // re-insert to keep Map ordered by recency
      hits.set(key, recent)

      if (hits.size > maxKeys) {
        const oldestKey = hits.keys().next().value
        if (oldestKey !== undefined) hits.delete(oldestKey)
      }
      return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 }
    },
  }
}

/** Extract a best-effort client IP for rate-limit keys (never used for authorization). */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? 'unknown'
}
