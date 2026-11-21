import type { NextRequest } from 'next/server'
import { redirectTo, resolveAuthRedirect } from '@/lib/auth/callback'
import { logger } from '@/lib/logger'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/** PKCE code exchange for email confirmation and password-recovery links. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const { success, failure } = resolveAuthRedirect(searchParams.get('next'))
  const code = searchParams.get('code')

  if (!isSupabaseConfigured() || !code) return redirectTo(failure)

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    logger.warn('auth.code_exchange_failed', { code: error.code })
    return redirectTo(failure)
  }
  return redirectTo(success)
}
