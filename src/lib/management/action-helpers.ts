import 'server-only'
import { headers } from 'next/headers'
import { getCurrentUser, type SessionUser } from '@/lib/auth/session'
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/config'
import { logger } from '@/lib/logger'
import { clientIpFromHeaders, createMemoryRateLimiter } from '@/lib/rate-limit'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { errorState, mapDbError, type ActionState, type DbError } from './action-state'

export const log = logger.child({ module: 'management' })

/** Optional text values from a form: missing → undefined (zod handles the rest). */
export function formValues<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string | undefined> {
  const out = {} as Record<K, string | undefined>
  for (const key of keys) {
    const v = formData.get(key)
    out[key] = typeof v === 'string' ? v : undefined
  }
  return out
}

export function readLocale(formData: FormData): Locale {
  const v = formData.get('locale')
  return isLocale(v) ? v : defaultLocale
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>
export type ActionContext = { user: SessionUser; supabase: Supabase }

/**
 * Common gate for every management action: a real signed-in user is required. Preview
 * mode is read-only. Authorization itself is enforced by the database (RLS + checks in
 * the SECURITY DEFINER functions), so a forged form cannot do more than the UI offers.
 */
export async function beginAction(): Promise<ActionContext | ActionState<never>> {
  if (!isSupabaseConfigured()) {
    const user = await getCurrentUser()
    return errorState(user?.isPreview ? 'previewReadOnly' : 'notConfigured')
  }
  const user = await getCurrentUser()
  if (!user) return errorState('forbidden')
  return { user, supabase: await createSupabaseServerClient() }
}

export function isActionContext(v: ActionContext | ActionState<never>): v is ActionContext {
  return 'supabase' in v
}

/** Log unexpected database errors (never the values) and convert to a state. */
export function dbFailure(op: string, error: DbError): ActionState<never> {
  const key = mapDbError(error)
  if (key === 'generic') log.error('management.action_failed', { op, code: error.code })
  else log.info('management.action_refused', { op, code: error.code, reason: key })
  return errorState(key)
}

// Per-instance limits (see rate-limit.ts); the database enforces authorization anyway.
const limiters = {
  invite: createMemoryRateLimiter({ limit: 30, windowMs: 10 * 60_000 }),
  upload: createMemoryRateLimiter({ limit: 20, windowMs: 10 * 60_000 }),
  tenant: createMemoryRateLimiter({ limit: 20, windowMs: 60 * 60_000 }),
  accept: createMemoryRateLimiter({ limit: 20, windowMs: 10 * 60_000 }),
  lead: createMemoryRateLimiter({ limit: 60, windowMs: 10 * 60_000 }),
  ticket: createMemoryRateLimiter({ limit: 60, windowMs: 10 * 60_000 }),
  study: createMemoryRateLimiter({ limit: 30, windowMs: 10 * 60_000 }),
  join: createMemoryRateLimiter({ limit: 20, windowMs: 10 * 60_000 }),
  staff: createMemoryRateLimiter({ limit: 30, windowMs: 10 * 60_000 }),
  workflow: createMemoryRateLimiter({ limit: 60, windowMs: 10 * 60_000 }),
  campus: createMemoryRateLimiter({ limit: 30, windowMs: 10 * 60_000 }),
}

export async function isRateLimited(kind: keyof typeof limiters, userId: string): Promise<boolean> {
  const ip = clientIpFromHeaders(await headers())
  return !limiters[kind].check(`${kind}:${userId}`).allowed || !limiters[kind].check(`${kind}:ip:${ip}`).allowed
}
