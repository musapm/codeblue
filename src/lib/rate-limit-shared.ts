import 'server-only'
import { createHmac } from 'node:crypto'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createMemoryRateLimiter, type RateLimiterOptions, type RateLimitResult } from './rate-limit'

/**
 * Rate limits shared by every server instance (Phase 16, migration 22).
 *
 * With Supabase and RATE_LIMIT_SECRET configured, each check increments a counter in the
 * database (public.rate_limit_hit). The bucket sent is an HMAC of "<name>:<key>" made with the
 * secret, so the database never sees emails, user ids or IP addresses, and nobody without the
 * secret can fill another person's bucket. Otherwise (preview, tests, local development, or if
 * the database call fails) the per-instance memory limiter is used, and a failure is logged.
 */

export interface SharedRateLimiter {
  check(key: string): Promise<RateLimitResult>
}

const log = logger.child({ module: 'rate-limit' })

export function rateLimitBucket(secret: string, name: string, key: string): string {
  return createHmac('sha256', secret).update(`${name}:${key}`).digest('hex')
}

function sharedSecret(): string | null {
  const secret = process.env.RATE_LIMIT_SECRET
  if (!secret || secret.length < 32 || process.env.UNIAGENT_UI_PREVIEW === 'true' || !isSupabaseConfigured()) return null
  return secret
}

export function createRateLimiter(name: string, options: Pick<RateLimiterOptions, 'limit' | 'windowMs'>): SharedRateLimiter {
  if (!/^[a-z][a-z0-9_.-]{1,40}$/.test(name)) throw new Error('Rate limiter names are short lowercase identifiers')
  const memory = createMemoryRateLimiter(options)
  const windowSeconds = Math.max(1, Math.round(options.windowMs / 1000))

  return {
    async check(key) {
      const secret = sharedSecret()
      if (!secret) return memory.check(`${name}:${key}`)
      try {
        const supabase = await createSupabaseServerClient()
        const { data, error } = await supabase.rpc('rate_limit_hit', {
          p_bucket: rateLimitBucket(secret, name, key),
          p_limit: options.limit,
          p_window_seconds: windowSeconds,
        })
        if (error || !data || typeof data !== 'object') throw new Error(error?.code ?? 'no result')
        const r = data as { allowed: boolean; remaining: number; retry_after_ms: number }
        return { allowed: r.allowed, remaining: r.remaining, retryAfterMs: r.retry_after_ms }
      } catch (error) {
        log.warn('rate_limit.shared_failed', { name, error: error instanceof Error ? error.message : 'unknown' })
        return memory.check(`${name}:${key}`)
      }
    },
  }
}
