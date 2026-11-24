/**
 * Security headers applied to every response (see docs/security.md and ADR-013).
 *
 * Kept free of path aliases and `server-only` so `next.config.ts` can import it.
 */

export type SecurityHeaderOptions = {
  isDev: boolean
  /** Supabase project URL, if configured, so the browser may call Auth/Storage. */
  supabaseUrl?: string
  /** Cloudflare Turnstile is configured: allow its script and challenge frame. */
  turnstile?: boolean
  /**
   * Per-request nonce (signed-in app and platform pages, set by the proxy). Scripts then need
   * the nonce ('strict-dynamic' lets them load their own chunks); 'unsafe-inline' is dropped.
   */
  nonce?: string
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

export function buildContentSecurityPolicy({ isDev, supabaseUrl, turnstile, nonce }: SecurityHeaderOptions): string {
  const supabaseOrigin = originOf(supabaseUrl)
  const connect = ["'self'"]
  if (supabaseOrigin) {
    connect.push(supabaseOrigin, supabaseOrigin.replace(/^http/, 'ws'))
  }
  if (isDev) connect.push('ws:') // Next.js dev HMR

  const img = ["'self'", 'data:', 'blob:']
  if (supabaseOrigin) img.push(supabaseOrigin) // tenant logos via Supabase Storage

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Public pages are prerendered, so their inline bootstrap scripts cannot carry a nonce and
    // need 'unsafe-inline'. Signed-in pages are rendered per request with a nonce (ADR-036).
    'script-src': nonce
      ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])]
      : ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...(turnstile ? [TURNSTILE_ORIGIN] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': img,
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'frame-src': turnstile ? ["'self'", TURNSTILE_ORIGIN] : ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  }

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`)
  if (!isDev) policy.push('upgrade-insecure-requests')
  return policy.join('; ')
}

/** Headers for every response; the Content-Security-Policy is separate (see contentSecurityPolicyHeader). */
export function buildSecurityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      // The microphone is allowed for this site only: voice input in the chats (Phase 13).
      value: 'camera=(), microphone=(self), geolocation=(self), payment=(), usb=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ]
  if (!options.isDev) {
    // No `preload` until the production domains are final (preload lists are hard to leave).
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' })
  }
  return headers
}

/** Paths whose pages are rendered per request and get a nonce-based policy from the proxy. */
export const NONCE_PATH = /^\/(?:en|ar)\/(?:app|platform)(?:\/|$)/

/** next.config `source` for every path EXCEPT the nonce ones (they get their policy from the proxy). */
export const STATIC_CSP_SOURCE = '/((?!(?:en|ar)/(?:app|platform)(?:/|$)).*)'
