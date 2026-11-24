'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { publicEnv } from '@/lib/env/public'
import { defaultLocale, isLocale, localizedPath, type Locale } from '@/lib/i18n/config'
import { logger } from '@/lib/logger'
import { clientIpFromHeaders } from '@/lib/rate-limit'
import { createRateLimiter } from '@/lib/rate-limit-shared'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema, toFieldErrors } from './schemas'
import { getMfaState, mfaStep, verifyPath } from './mfa'
import { mapAuthErrorCode, type AuthActionState } from './state'

const log = logger.child({ module: 'auth' })

// Per-instance limits (see rate-limit.ts). Supabase Auth applies its own limits too.
const ipLimiter = createRateLimiter('auth.ip', { limit: 20, windowMs: 10 * 60_000 })
const emailLimiter = createRateLimiter('auth.email', { limit: 5, windowMs: 10 * 60_000 })

/** Turnstile token from the form (only present when CAPTCHA is configured). */
function captchaToken(formData: FormData): string | undefined {
  const v = formData.get('captchaToken')
  return typeof v === 'string' && v.length > 0 && v.length <= 4096 ? v : undefined
}

function readLocale(formData: FormData): Locale {
  const value = formData.get('locale')
  return isLocale(value) ? value : defaultLocale
}

async function isRateLimited(action: string, email?: string): Promise<boolean> {
  const ip = clientIpFromHeaders(await headers())
  if (!(await ipLimiter.check(`${action}:ip:${ip}`)).allowed) return true
  if (email && !(await emailLimiter.check(`${action}:email:${email}`)).allowed) return true
  return false
}

/**
 * Absolute URL for links in auth emails. Built from the configured site URL — never from
 * the request Host header, which an attacker could spoof (reset-link poisoning).
 */
function authCallbackUrl(nextPath: string): string {
  return `${publicEnv.siteUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`
}

export async function signIn(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = readLocale(formData)
  if (!isSupabaseConfigured()) return { status: 'error', error: 'notConfigured' }

  const parsed = signInSchema.safeParse({ email: formData.get('email'), password: formData.get('password') })
  const email = typeof formData.get('email') === 'string' ? String(formData.get('email')) : undefined
  if (!parsed.success) return { status: 'error', fieldErrors: toFieldErrors(parsed.error), email }

  if (await isRateLimited('signin', parsed.data.email)) return { status: 'error', error: 'rateLimited', email }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ ...parsed.data, options: { captchaToken: captchaToken(formData) } })
  if (error) {
    const key = mapAuthErrorCode(error.code)
    if (key === 'generic') log.warn('auth.signin_failed', { code: error.code, status: error.status })
    return { status: 'error', error: key, email }
  }

  const next = safeRedirectPath(formData.get('next'), localizedPath(locale, '/app'))
  // Two-step sign-in set up: the password was the first step, the code comes next (ADR-036).
  if (mfaStep(await getMfaState(supabase), false) === 'verify') redirect(verifyPath(localizedPath(locale, ''), next))
  redirect(next)
}

export async function signUp(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = readLocale(formData)
  if (!isSupabaseConfigured()) return { status: 'error', error: 'notConfigured' }

  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  const email = typeof formData.get('email') === 'string' ? String(formData.get('email')) : undefined
  if (!parsed.success) return { status: 'error', fieldErrors: toFieldErrors(parsed.error), email }

  if (await isRateLimited('signup', parsed.data.email)) return { status: 'error', error: 'rateLimited', email }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Return to where sign-up started (e.g. an invitation link), never to another site.
      emailRedirectTo: authCallbackUrl(safeRedirectPath(formData.get('next'), localizedPath(locale, '/app'))),
      data: { full_name: parsed.data.fullName, locale },
      captchaToken: captchaToken(formData),
    },
  })
  if (error) {
    const key = mapAuthErrorCode(error.code)
    // Do not reveal whether an account already exists.
    if (error.code === 'user_already_exists' || error.code === 'email_exists') return { status: 'success' }
    if (key === 'generic') log.warn('auth.signup_failed', { code: error.code, status: error.status })
    return { status: 'error', error: key, email }
  }
  return { status: 'success' }
}

export async function requestPasswordReset(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = readLocale(formData)
  if (!isSupabaseConfigured()) return { status: 'error', error: 'notConfigured' }

  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') })
  const email = typeof formData.get('email') === 'string' ? String(formData.get('email')) : undefined
  if (!parsed.success) return { status: 'error', fieldErrors: toFieldErrors(parsed.error), email }

  if (await isRateLimited('reset', parsed.data.email)) return { status: 'error', error: 'rateLimited', email }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: authCallbackUrl(localizedPath(locale, '/reset-password')),
    captchaToken: captchaToken(formData),
  })
  if (error && mapAuthErrorCode(error.code) === 'rateLimited') return { status: 'error', error: 'rateLimited', email }
  if (error) log.warn('auth.reset_request_failed', { code: error.code, status: error.status })
  // Same response whether or not the account exists (no account enumeration).
  return { status: 'success' }
}

export async function updatePassword(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = readLocale(formData)
  if (!isSupabaseConfigured()) return { status: 'error', error: 'notConfigured' }

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) return { status: 'error', fieldErrors: toFieldErrors(parsed.error) }

  if (await isRateLimited('update-password')) return { status: 'error', error: 'rateLimited' }

  const supabase = await createSupabaseServerClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  // Anonymous visitor sessions have no account to set a password for.
  if (userError || !userData.user || userData.user.is_anonymous) return { status: 'error', error: 'linkExpired' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    const key = mapAuthErrorCode(error.code)
    if (key === 'generic') log.warn('auth.update_password_failed', { code: error.code, status: error.status })
    return { status: 'error', error: key }
  }
  redirect(localizedPath(locale, '/app'))
}

export async function signOut(formData: FormData): Promise<void> {
  const locale = readLocale(formData)
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.signOut()
    if (error) log.warn('auth.signout_failed', { code: error.code })
  }
  // Optional same-origin return path (e.g. sign in with another account to accept an invitation).
  const next = safeRedirectPath(formData.get('next'), '')
  redirect(localizedPath(locale, '/login') + (next ? `?next=${encodeURIComponent(next)}` : ''))
}
