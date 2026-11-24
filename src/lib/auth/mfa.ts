import 'server-only'
import type { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Two-step sign-in with an authenticator app (TOTP, Supabase Auth MFA; Phase 16, ADR-036).
 * The database refuses a first-step session of an account that has set it up (migration 23);
 * the app sends such a session to the code step. Platform staff must set it up unless
 * PLATFORM_MFA=optional.
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type MfaState = { current: string | null; next: string | null; verifiedFactorId: string | null }
export type MfaStep = 'ok' | 'verify' | 'enroll'

export function mfaStep(state: MfaState, required: boolean): MfaStep {
  if (state.next === 'aal2' && state.current !== 'aal2') return 'verify'
  if (required && !state.verifiedFactorId) return 'enroll'
  return 'ok'
}

export const platformMfaRequired = (env: Record<string, string | undefined> = process.env) => env.PLATFORM_MFA !== 'optional'

/** Reads the session's assurance level (from the token, no network call) and the verified factor. */
export async function getMfaState(supabase: Supabase, withFactors = false): Promise<MfaState> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  let verifiedFactorId: string | null = null
  if (withFactors || data?.nextLevel === 'aal2') {
    const factors = await supabase.auth.mfa.listFactors()
    verifiedFactorId = factors.data?.totp?.[0]?.id ?? null
  }
  return { current: data?.currentLevel ?? null, next: data?.nextLevel ?? null, verifiedFactorId }
}

/** Where to send someone for the code step, keeping where they were going. */
export const verifyPath = (localePrefix: string, next: string | undefined) => `${localePrefix}/login/verify${next ? `?next=${encodeURIComponent(next)}` : ''}`
