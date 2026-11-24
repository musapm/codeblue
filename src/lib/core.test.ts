import { describe, expect, it } from 'vitest'
import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema, toFieldErrors } from './auth/schemas'
import { isPreviewModeActive } from './auth/preview'
import { mapAuthErrorCode } from './auth/state'
import { resolvePlatformBranding } from './branding/platform'
import { buildInquiryMailto, contactSchema } from './contact/schema'
import { parsePublicEnv } from './env/public'
import { parseServerEnv } from './env/server'
import { AppError, toPublicError } from './errors'
import { FEATURES } from './features/catalog'
import { canSeeNavItem, filterNav, plannedSegments, PLATFORM_NAV, WORKSPACE_NAV } from './navigation/workspace-nav'
import { isPermissionKey, PERMISSION_KEYS } from './permissions/catalog'
import { buildContentSecurityPolicy, buildSecurityHeaders } from './security/headers'

describe('preview mode (ADR-012)', () => {
  it('is only active when the flag is on AND no auth backend is configured', () => {
    expect(isPreviewModeActive({ flagEnabled: true, supabaseConfigured: false })).toBe(true)
    expect(isPreviewModeActive({ flagEnabled: true, supabaseConfigured: true })).toBe(false)
    expect(isPreviewModeActive({ flagEnabled: false, supabaseConfigured: false })).toBe(false)
  })
})

describe('auth schemas', () => {
  it('normalizes email and accepts valid sign-in', () => {
    const r = signInSchema.safeParse({ email: '  Student@Example.EDU ', password: 'x' })
    expect(r.success && r.data.email).toBe('student@example.edu')
  })

  it('returns translatable error keys', () => {
    const r = signUpSchema.safeParse({ fullName: '', email: 'nope', password: 'short' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(toFieldErrors(r.error)).toEqual({ fullName: 'nameRequired', email: 'emailInvalid', password: 'passwordTooShort' })
    }
  })

  it('enforces password bounds and confirmation', () => {
    expect(resetPasswordSchema.safeParse({ password: 'a'.repeat(73), confirmPassword: 'a'.repeat(73) }).success).toBe(false)
    const mismatch = resetPasswordSchema.safeParse({ password: 'correct horse battery', confirmPassword: 'different value!' })
    expect(!mismatch.success && toFieldErrors(mismatch.error)).toEqual({ confirmPassword: 'passwordsDoNotMatch' })
    expect(resetPasswordSchema.safeParse({ password: 'correct horse battery', confirmPassword: 'correct horse battery' }).success).toBe(true)
  })

  it('handles missing form values', () => {
    const r = forgotPasswordSchema.safeParse({ email: null })
    expect(!r.success && toFieldErrors(r.error)).toEqual({ email: 'emailRequired' })
  })

  it('maps provider errors without leaking details', () => {
    expect(mapAuthErrorCode('invalid_credentials')).toBe('invalidCredentials')
    expect(mapAuthErrorCode('over_request_rate_limit')).toBe('rateLimited')
    expect(mapAuthErrorCode('some_new_code')).toBe('generic')
    expect(mapAuthErrorCode(undefined)).toBe('generic')
  })
})

describe('contact schema', () => {
  const valid = {
    name: 'Amina Hassan',
    email: 'amina@university.example',
    organization: 'Example University',
    message: 'We would like a demo of the admissions assistant for next term.',
    consent: 'on',
  }

  it('requires explicit consent', () => {
    const r = contactSchema.safeParse({ ...valid, consent: null })
    expect(!r.success && toFieldErrors(r.error).consent).toBe('consentRequired')
    expect(contactSchema.safeParse(valid).success).toBe(true)
  })

  it('builds an encoded mailto link', () => {
    const parsed = contactSchema.parse(valid)
    const link = buildInquiryMailto('sales@example.com', parsed, 'Inquiry')
    expect(link.startsWith('mailto:sales%40example.com?subject=')).toBe(true)
    expect(link).not.toContain('+')
    expect(decodeURIComponent(link)).toContain('Organization: Example University')
  })
})

describe('environment parsing', () => {
  it('applies safe defaults and the legacy anon key fallback', () => {
    expect(parsePublicEnv({})).toEqual({ siteUrl: 'http://localhost:3000', supabaseUrl: undefined, supabasePublishableKey: undefined, turnstileSiteKey: undefined })
    expect(parsePublicEnv({ NEXT_PUBLIC_SITE_URL: 'https://app.example.com/', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' })).toMatchObject({
      siteUrl: 'https://app.example.com',
      supabasePublishableKey: 'anon',
    })
  })

  it('rejects invalid URLs without echoing values', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'ftp://secret-host' })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    try {
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'ftp://secret-host' })
    } catch (e) {
      expect(String(e)).not.toContain('secret-host')
    }
  })

  it('parses server flags', () => {
    expect(parseServerEnv({ UNIAGENT_UI_PREVIEW: 'true' }).UNIAGENT_UI_PREVIEW).toBe(true)
    expect(parseServerEnv({}).UNIAGENT_UI_PREVIEW).toBe(false)
    expect(() => parseServerEnv({ UNIAGENT_UI_PREVIEW: 'yes' })).toThrow(/UNIAGENT_UI_PREVIEW/)
  })
})

describe('platform branding', () => {
  it('is configurable and validates colors', () => {
    const b = resolvePlatformBranding({ NEXT_PUBLIC_PLATFORM_NAME: 'Campus Copilot', NEXT_PUBLIC_PLATFORM_PRIMARY_COLOR: 'javascript:1' })
    expect(b.name).toBe('Campus Copilot')
    expect(b.assistantName).toBe('Campus Copilot Assistant')
    expect(b.colors.primary).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('errors', () => {
  it('never exposes internal messages', () => {
    const pub = toPublicError(new Error('duplicate key value violates unique constraint "x"'), 'ref1')
    expect(pub).toEqual({ code: 'internal', status: 500, referenceId: 'ref1' })
    expect(toPublicError(new AppError('rate_limited', 'too many', { publicDetails: { retryAfter: 30 } }), 'r')).toMatchObject({
      code: 'rate_limited',
      status: 429,
      details: { retryAfter: 30 },
    })
  })
})

describe('navigation model', () => {
  it('references only catalogued permissions and features', () => {
    for (const item of WORKSPACE_NAV.flatMap((s) => s.items)) {
      if (item.permission) expect(isPermissionKey(item.permission)).toBe(true)
      for (const feature of typeof item.feature === 'string' ? [item.feature] : (item.feature ?? [])) expect(Object.hasOwn(FEATURES, feature)).toBe(true)
    }
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length)
  })

  it('filters by permissions and features', () => {
    const visible = filterNav(WORKSPACE_NAV, {
      kind: 'scoped',
      permissions: new Set(['tickets.read_department', 'tenant.settings.read']),
      features: new Set(['ticketing']),
    })
    const keys = visible.flatMap((s) => s.items.map((i) => i.key))
    expect(keys).toEqual(['overview', 'tickets', 'settings'])
  })

  it('a list of features means any one of them', () => {
    const quality = WORKSPACE_NAV.flatMap((s) => s.items).find((i) => i.key === 'quality')!
    const can = (features: string[]) => canSeeNavItem(quality, { kind: 'scoped', permissions: new Set(['quality.review']), features: new Set(features) })
    expect(can(['student_assistant'])).toBe(true)
    expect(can(['admissions_agent'])).toBe(true)
    expect(can(['analytics_basic'])).toBe(false)
  })

  it('exposes planned module segments for placeholder routes', () => {
    expect(plannedSegments(WORKSPACE_NAV)).toEqual([]) // every workspace module is built (integrations in Phase 14)
    expect(plannedSegments(PLATFORM_NAV)).toContain('plans')
    expect(plannedSegments(WORKSPACE_NAV)).not.toContain('campus') // built in Phase 12
    expect(plannedSegments(WORKSPACE_NAV)).not.toContain('workflows') // built in Phase 11
    expect(plannedSegments(WORKSPACE_NAV)).not.toContain('academic') // built in Phase 9
    expect(plannedSegments(WORKSPACE_NAV)).not.toContain('tickets') // built in Phase 7
    expect(plannedSegments(WORKSPACE_NAV)).not.toContain('settings')
    expect(plannedSegments(WORKSPACE_NAV)).not.toContain('knowledge') // built in Phase 4
  })
})

describe('security headers', () => {
  it('sets strict framing and object policies', () => {
    const csp = buildContentSecurityPolicy({ isDev: false, supabaseUrl: 'https://abc.supabase.co' })
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('connect-src \'self\' https://abc.supabase.co wss://abc.supabase.co')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain('upgrade-insecure-requests')
  })

  it('adds HSTS only in production', () => {
    const prod = buildSecurityHeaders({ isDev: false }).map((h) => h.key)
    const dev = buildSecurityHeaders({ isDev: true }).map((h) => h.key)
    expect(prod).toContain('Strict-Transport-Security')
    expect(dev).not.toContain('Strict-Transport-Security')
    expect(buildContentSecurityPolicy({ isDev: true })).toContain("'unsafe-eval'")
  })

  it('allows Cloudflare Turnstile only when it is configured', () => {
    const off = buildContentSecurityPolicy({ isDev: false })
    const on = buildContentSecurityPolicy({ isDev: false, turnstile: true })
    expect(off).not.toContain('challenges.cloudflare.com')
    expect(on).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/)
    expect(on).toContain("frame-src 'self' https://challenges.cloudflare.com")
  })
})
