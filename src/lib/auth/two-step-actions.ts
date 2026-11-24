'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { platformBranding } from '@/lib/branding/platform'
import { defaultLocale, isLocale, localizedPath, type Locale } from '@/lib/i18n/config'
import { logger } from '@/lib/logger'
import { clientIpFromHeaders } from '@/lib/rate-limit'
import { createRateLimiter } from '@/lib/rate-limit-shared'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Two-step sign-in (Phase 16, ADR-036): the code step after the password, and setting up or
 * removing an authenticator app. Supabase Auth checks the codes; removing a verified factor
 * needs a second-step session, which Supabase also enforces.
 */

export type TwoStepState =
  | { status: 'idle' }
  | { status: 'error'; error: 'invalidCode' | 'rateLimited' | 'notConfigured' | 'generic' }
  | { status: 'enrolling'; factorId: string; qrCode: string; secret: string }
  | { status: 'done' }

const log = logger.child({ module: 'auth.two_step' })
const codeSchema = z.string().trim().regex(/^\d{6}$/)
// Six-digit codes: few tries per person, shared across instances when configured.
const userLimiter = createRateLimiter('auth.mfa.user', { limit: 10, windowMs: 10 * 60_000 })
const ipLimiter = createRateLimiter('auth.mfa.ip', { limit: 30, windowMs: 10 * 60_000 })

const readLocale = (formData: FormData): Locale => {
  const v = formData.get('locale')
  return isLocale(v) ? v : defaultLocale
}

async function limited(userId: string): Promise<boolean> {
  const ip = clientIpFromHeaders(await headers())
  return !(await userLimiter.check(`user:${userId}`)).allowed || !(await ipLimiter.check(`ip:${ip}`)).allowed
}

async function session() {
  if (!isSupabaseConfigured()) return null
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return data.user && !data.user.is_anonymous ? { supabase, userId: data.user.id } : null
}

/** The code step after the password. */
export async function verifyTwoStep(_prev: TwoStepState, formData: FormData): Promise<TwoStepState> {
  const locale = readLocale(formData)
  const s = await session()
  if (!s) return { status: 'error', error: 'notConfigured' }
  const code = codeSchema.safeParse(formData.get('code'))
  if (!code.success) return { status: 'error', error: 'invalidCode' }
  if (await limited(s.userId)) return { status: 'error', error: 'rateLimited' }
  const factors = await s.supabase.auth.mfa.listFactors()
  const factorId = factors.data?.totp?.[0]?.id
  if (!factorId) redirect(safeRedirectPath(formData.get('next'), localizedPath(locale, '/app')))
  const { error } = await s.supabase.auth.mfa.challengeAndVerify({ factorId, code: code.data })
  if (error) {
    log.info('auth.two_step_refused', { code: error.code })
    return { status: 'error', error: 'invalidCode' }
  }
  redirect(safeRedirectPath(formData.get('next'), localizedPath(locale, '/app')))
}

/** Starts setting up an authenticator app: a QR code and the secret to type in by hand. */
export async function startTwoStep(): Promise<TwoStepState> {
  const s = await session()
  if (!s) return { status: 'error', error: 'notConfigured' }
  if (await limited(s.userId)) return { status: 'error', error: 'rateLimited' }
  // An earlier set-up that was never finished is replaced.
  const factors = await s.supabase.auth.mfa.listFactors()
  for (const f of factors.data?.all ?? []) if (f.status === 'unverified') await s.supabase.auth.mfa.unenroll({ factorId: f.id })
  const { data, error } = await s.supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${platformBranding.name} ${new Date().toISOString().slice(0, 10)}` })
  if (error || !data) {
    log.warn('auth.two_step_enroll_failed', { code: error?.code })
    return { status: 'error', error: 'generic' }
  }
  return { status: 'enrolling', factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Confirms the set-up with a first code; the session becomes a second-step session. */
export async function confirmTwoStep(prev: TwoStepState, formData: FormData): Promise<TwoStepState> {
  const s = await session()
  if (!s) return { status: 'error', error: 'notConfigured' }
  if (prev.status !== 'enrolling') return { status: 'error', error: 'generic' }
  const code = codeSchema.safeParse(formData.get('code'))
  if (!code.success) return { ...prev }
  if (await limited(s.userId)) return { status: 'error', error: 'rateLimited' }
  const { error } = await s.supabase.auth.mfa.challengeAndVerify({ factorId: prev.factorId, code: code.data })
  if (error) return { ...prev }
  const next = safeRedirectPath(formData.get('next'), '')
  if (next) redirect(next)
  return { status: 'done' }
}

/** Removes the authenticator app (needs a second-step session). */
export async function removeTwoStep(_prev: TwoStepState, formData: FormData): Promise<TwoStepState> {
  const s = await session()
  if (!s) return { status: 'error', error: 'notConfigured' }
  const factorId = z.uuid().safeParse(formData.get('factorId'))
  if (!factorId.success) return { status: 'error', error: 'generic' }
  const { error } = await s.supabase.auth.mfa.unenroll({ factorId: factorId.data })
  if (error) {
    log.warn('auth.two_step_remove_failed', { code: error.code })
    return { status: 'error', error: 'generic' }
  }
  redirect(localizedPath(readLocale(formData), '/two-step'))
}
