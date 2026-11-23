import 'server-only'
import { headers } from 'next/headers'
import { cache } from 'react'
import { getSessionIdentity } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { clientIpFromHeaders, createMemoryRateLimiter } from '@/lib/rate-limit'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { publicAdmissionsSchema, type PublicAdmissions } from './public'

/**
 * Visitor sessions for the public admissions page (ADR-025). A visitor who asks the assistant or
 * sends an inquiry gets an anonymous Supabase session, so every record has an owner and
 * per-visitor limits apply in the database. CAPTCHA (Turnstile) is verified by Supabase Auth
 * when it is enabled there. Signed-in users keep their own session.
 */

const log = logger.child({ module: 'admissions.visitor' })
const sessionLimiter = createMemoryRateLimiter({ limit: 10, windowMs: 10 * 60_000 })

export type VisitorSessionError = 'notConfigured' | 'sessionDisabled' | 'captcha' | 'rateLimited' | 'generic'

export async function ensureVisitorSession(captchaToken: string | undefined): Promise<{ ok: true } | { ok: false; error: VisitorSessionError }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'notConfigured' }
  if (await getSessionIdentity()) return { ok: true }
  const ip = clientIpFromHeaders(await headers())
  if (!sessionLimiter.check(`visitor:${ip}`).allowed) return { ok: false, error: 'rateLimited' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken } })
  if (!error) return { ok: true }
  switch (error.code) {
    case 'anonymous_provider_disabled':
      return { ok: false, error: 'sessionDisabled' }
    case 'captcha_failed':
      return { ok: false, error: 'captcha' }
    case 'over_request_rate_limit':
      return { ok: false, error: 'rateLimited' }
    default:
      log.warn('admissions.visitor_session_failed', { code: error.code, status: error.status })
      return { ok: false, error: 'generic' }
  }
}

/** The public admissions page of a university, or null (unknown, unpublished, suspended…). */
export const getPublicAdmissions = cache(async (slug: string): Promise<PublicAdmissions | null> => {
  if (!isSupabaseConfigured()) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('public_admissions', { p_tenant_slug: slug })
  if (error) {
    log.error('admissions.public_failed', { code: error.code })
    return null
  }
  if (data === null) return null
  const parsed = publicAdmissionsSchema.safeParse(data)
  if (!parsed.success) {
    log.error('admissions.public_invalid_payload')
    return null
  }
  return parsed.data
})
