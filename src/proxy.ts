import { NextResponse, type NextRequest } from 'next/server'
import { LOCALE_COOKIE, localizedPath, splitLocaleFromPath } from '@/lib/i18n/config'
import { negotiateLocale } from '@/lib/i18n/negotiate'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { buildContentSecurityPolicy, NONCE_PATH } from '@/lib/security/headers'
import { updateSupabaseSession } from '@/lib/supabase/proxy'

const PROTECTED_PREFIXES = ['/app', '/platform']

function isProtected(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/**
 * Runs before routes render (Next.js 16 "proxy", formerly middleware):
 * 1. Ensures every page URL has a supported locale prefix (/en, /ar).
 * 2. Refreshes the Supabase session cookie.
 * 3. Redirects unauthenticated visitors away from /app and /platform.
 *
 * Step 3 is a UX shortcut only. Real authorization happens in the Data Access Layer and
 * in database Row Level Security — never rely on this file for access control.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const { locale, rest } = splitLocaleFromPath(pathname)

  if (!locale) {
    const target = negotiateLocale(request.headers.get('accept-language'), request.cookies.get(LOCALE_COOKIE)?.value)
    const url = request.nextUrl.clone()
    url.pathname = localizedPath(target, pathname)
    url.search = search
    return NextResponse.redirect(url)
  }

  // Signed-in pages: a fresh nonce per request. Next.js reads it from the request's policy and
  // puts it on its own scripts; the same policy goes on the response.
  let csp: string | null = null
  if (NONCE_PATH.test(pathname)) {
    const nonce = btoa(crypto.randomUUID())
    csp = buildContentSecurityPolicy({
      isDev: process.env.NODE_ENV === 'development',
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      nonce,
    })
    request.headers.set('x-nonce', nonce)
    request.headers.set('Content-Security-Policy', csp)
  }
  const withCsp = (res: NextResponse) => {
    if (csp) res.headers.set('Content-Security-Policy', csp)
    return res
  }

  const response = NextResponse.next({ request })
  if (!isSupabaseConfigured()) return withCsp(response)

  const { response: refreshed, hasSession } = await updateSupabaseSession(request, response)
  if (isProtected(rest) && !hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = localizedPath(locale, '/login')
    url.search = `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }
  return withCsp(refreshed)
}

export const config = {
  matcher: [
    // Everything except API routes, auth route handlers, Next.js internals and static files.
    '/((?!api/|auth/|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)',
  ],
}
