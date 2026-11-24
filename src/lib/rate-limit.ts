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

export const TRUSTED_IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'] as const

/**
 * The client IP for rate-limit keys (never used for authorization). Only the header that the
 * deployment's own edge sets can be trusted (Phase 16 review): `x-forwarded-for` on Vercel, which
 * overwrites it; `cf-connecting-ip` behind Cloudflare, where the first `x-forwarded-for` entry is
 * whatever the client sent and Vercel only sees Cloudflare's addresses. Set TRUSTED_IP_HEADER.
 */
export function clientIpFromHeaders(headers: Headers, trusted: string | undefined = process.env.TRUSTED_IP_HEADER): string {
  const header = (TRUSTED_IP_HEADERS as readonly string[]).includes(trusted ?? '') ? trusted! : 'x-forwarded-for'
  const value = headers.get(header)?.split(',')[0]?.trim()
  return value && value.length <= 64 ? value : 'unknown'
}
