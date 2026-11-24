import 'server-only'
import { isSameOrigin, jsonError as fail } from '@/lib/ai/http'
import { getCurrentUser } from '@/lib/auth/session'
import { clientIpFromHeaders, createMemoryRateLimiter } from '@/lib/rate-limit'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { VoiceError } from './server'

/** Shared guards for the voice endpoints: same origin, signed in, rate limited (per instance). */
const perUser = createMemoryRateLimiter({ limit: 60, windowMs: 5 * 60_000 })
const perIp = createMemoryRateLimiter({ limit: 180, windowMs: 5 * 60_000 })

export async function guardVoiceRequest(request: Request): Promise<Response | { userId: string }> {
  if (!isSameOrigin(request)) return fail(403, 'forbidden')
  if (!isSupabaseConfigured()) return fail(503, 'preview')
  const user = await getCurrentUser()
  if (!user || user.isPreview) return fail(401, 'forbidden')
  const ip = clientIpFromHeaders(request.headers)
  if (!perUser.check(`u:${user.id}`).allowed || !perIp.check(`ip:${ip}`).allowed) return fail(429, 'rateLimited')
  return { userId: user.id }
}

const STATUS: Record<VoiceError, number> = { notConfigured: 503, forbidden: 403, invalid: 400, off: 409, budget: 402, limit: 429, failed: 502 }

export const voiceFailure = (error: VoiceError) => fail(STATUS[error], error)
