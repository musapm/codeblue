/**
 * Security headers applied to every response (see docs/security.md and ADR-013).
 *
 * Kept free of path aliases and `server-only` so `next.config.ts` can import it.
 */

export type SecurityHeaderOptions = {
  isDev: boolean
  /** Supabase project URL, if configured, so the browser may call Auth/Storage. */
  supabaseUrl?: string
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function buildContentSecurityPolicy({ isDev, supabaseUrl }: SecurityHeaderOptions): string {
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
    // 'unsafe-inline' is required for Next.js inline bootstrap scripts on statically
    // prerendered pages. Nonce-based CSP for dynamic app routes is planned (ADR-013).
    'script-src': ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': img,
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
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

export function buildSecurityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  const headers = [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(options) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      // Microphone stays disabled until the voice module (Phase 13) explicitly enables it.
      value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ]
  if (!options.isDev) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' })
  }
  return headers
}
