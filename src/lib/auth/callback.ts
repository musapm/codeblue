import 'server-only'
import { NextResponse } from 'next/server'
import { publicEnv } from '@/lib/env/public'
import { defaultLocale, localizedPath, splitLocaleFromPath } from '@/lib/i18n/config'
import { safeRedirectPath } from '@/lib/safe-redirect'

/** Resolve the post-auth destination and the matching login page for failures. */
export function resolveAuthRedirect(nextParam: string | null) {
  const next = safeRedirectPath(nextParam, localizedPath(defaultLocale, '/app'))
  const locale = splitLocaleFromPath(next).locale ?? defaultLocale
  return {
    // Absolute URLs use the configured site URL, never the request Host header.
    success: new URL(next, publicEnv.siteUrl),
    failure: new URL(`${localizedPath(locale, '/login')}?error=link`, publicEnv.siteUrl),
  }
}

export function redirectTo(url: URL) {
  return NextResponse.redirect(url, { status: 303 })
}
