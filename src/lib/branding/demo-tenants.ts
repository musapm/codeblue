import type { Locale } from '@/lib/i18n/config'

/**
 * Fictional demo universities. These are NOT real institutions and contain no real data.
 * Used by the UI preview and the public white-label demo until tenants live in the
 * database (Phase 2/3), where the demo tenant is created by the seed script instead.
 */

export type TenantBrandingPreview = {
  slug: string
  name: Record<Locale, string>
  shortName: string
  assistantName: Record<Locale, string>
  welcome: Record<Locale, string>
  colors: { primary: string; secondary: string; accent: string }
  monogram: string
}

export const DEMO_TENANTS: TenantBrandingPreview[] = [
  {
    slug: 'northbridge',
    name: { en: 'Northbridge University', ar: 'جامعة نورثبريدج' },
    shortName: 'Northbridge',
    assistantName: { en: 'Northbridge Assistant', ar: 'مساعد نورثبريدج' },
    welcome: {
      en: 'Hi! Ask me about registration, fees, exams, or campus services.',
      ar: 'مرحباً! اسألني عن التسجيل أو الرسوم أو الامتحانات أو خدمات الحرم الجامعي.',
    },
    colors: { primary: '#1b4f8f', secondary: '#0f2a4a', accent: '#b7862c' },
    monogram: 'NU',
  },
  {
    slug: 'al-noor',
    name: { en: 'Al-Noor Institute of Technology', ar: 'معهد النور للتقنية' },
    shortName: 'Al-Noor Tech',
    assistantName: { en: 'Noor Digital Campus', ar: 'نور — الحرم الرقمي' },
    welcome: {
      en: 'Welcome to the digital campus. How can I help you today?',
      ar: 'أهلاً بك في الحرم الرقمي. كيف يمكنني مساعدتك اليوم؟',
    },
    colors: { primary: '#0f766e', secondary: '#134e4a', accent: '#c2410c' },
    monogram: 'AN',
  },
]

export const PREVIEW_TENANT = DEMO_TENANTS[0]!

export function findDemoTenant(slug: string): TenantBrandingPreview | undefined {
  return DEMO_TENANTS.find((t) => t.slug === slug)
}
