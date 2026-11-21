import type { EmailOtpType } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { redirectTo, resolveAuthRedirect } from '@/lib/auth/callback'
import { logger } from '@/lib/logger'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const OTP_TYPES: readonly EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

/**
 * token_hash verification (works even when the link is opened in a different browser).
 * Email templates point here: /auth/confirm?token_hash={{ .TokenHash }}&type=…&next=…
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const { success, failure } = resolveAuthRedirect(searchParams.get('next'))
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  if (!isSupabaseConfigured() || !tokenHash || !type || !OTP_TYPES.includes(type)) return redirectTo(failure)

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) {
    logger.warn('auth.otp_verify_failed', { code: error.code })
    return redirectTo(failure)
  }
  return redirectTo(success)
}
