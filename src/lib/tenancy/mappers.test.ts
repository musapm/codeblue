import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '@/lib/branding/theme'
import {
  deriveMonogram,
  isOperating,
  tenantAccessPayloadSchema,
  toTenantAccess,
  toTenantSummary,
  workspacesPayloadSchema,
} from './mappers'

const fallbacks = { assistantName: (n: string) => `${n} Assistant`, welcome: 'Hello' }

const workspace = {
  slug: 'northbridge',
  name: 'Northbridge University',
  name_translations: { ar: 'جامعة نورثبريدج' },
  status: 'trial',
  default_locale: 'en',
  timezone: 'Africa/Khartoum',
  is_demo: true,
  branding: { primary: '#0f766e', assistant_name: 'NB Assistant', assistant_name_ar: 'مساعد', welcome_ar: 'أهلاً' },
}

describe('tenancy mappers', () => {
  it('maps a workspace using the database values (no hardcoded time zone or locale)', () => {
    const [w] = workspacesPayloadSchema.parse([workspace])
    const en = toTenantSummary(w!, w!.branding, 'en', fallbacks)
    expect(en).toMatchObject({ slug: 'northbridge', name: 'Northbridge University', timezone: 'Africa/Khartoum', defaultLocale: 'en', isDemo: true })
    expect(en.assistantName).toBe('NB Assistant')
    expect(en.welcome).toBe('Hello')
    expect(en.colors.primary).toBe('#0f766e')
    const ar = toTenantSummary(w!, w!.branding, 'ar', fallbacks)
    expect(ar.name).toBe('جامعة نورثبريدج')
    expect(ar.assistantName).toBe('مساعد')
    expect(ar.welcome).toBe('أهلاً')
  })

  it('never lets invalid branding colors through (CSS-injection defense)', () => {
    const [w] = workspacesPayloadSchema.parse([{ ...workspace, branding: { primary: 'red;background:url(x)' } }])
    expect(toTenantSummary(w!, w!.branding, 'en', fallbacks).colors.primary).toBe(DEFAULT_THEME.primary)
  })

  it('tolerates malformed optional fields but rejects bad structure', () => {
    const [w] = workspacesPayloadSchema.parse([{ ...workspace, branding: 'nonsense', name_translations: null, default_locale: 'fr' }])
    expect(w!.branding).toEqual({})
    expect(w!.default_locale).toBe('en')
    expect(workspacesPayloadSchema.safeParse([{ slug: 'x' }]).success).toBe(false)
    expect(workspacesPayloadSchema.safeParse([{ ...workspace, status: 'deleted' }]).success).toBe(false)
  })

  it('builds a scoped access snapshot from real permissions and features', () => {
    const payload = tenantAccessPayloadSchema.parse({
      tenant: { ...workspace, id: '00000000-0000-4000-8000-000000000001' },
      branding: {},
      access_via: 'membership',
      roles: ['student'],
      permissions: ['assistant.use', 'tickets.create'],
      department_ids: [],
      features: ['student_assistant'],
    })
    const access = toTenantAccess(payload)
    expect(access.access.kind).toBe('scoped')
    if (access.access.kind === 'scoped') {
      expect(access.access.permissions.has('assistant.use')).toBe(true)
      expect(access.access.permissions.has('members.read')).toBe(false)
      expect(access.access.features.has('student_assistant')).toBe(true)
    }
  })

  it('derives monograms and operating status', () => {
    expect(deriveMonogram('Northbridge University')).toBe('NU')
    expect(deriveMonogram('University of the Nile')).toBe('UN')
    expect(isOperating('trial')).toBe(true)
    expect(isOperating('suspended')).toBe(false)
  })
})
