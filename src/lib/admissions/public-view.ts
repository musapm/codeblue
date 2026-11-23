import 'server-only'
import { logoPublicUrl } from '@/lib/branding/logo'
import { buildThemeVariables } from '@/lib/branding/theme'
import type { Locale } from '@/lib/i18n/config'
import { deriveMonogram } from '@/lib/tenancy/mappers'
import type { PublicAdmissions } from './public'

/** Branding of a university's public admissions pages (published branding only). */
export function publicBranding(page: PublicAdmissions, locale: Locale) {
  const b = page.branding as Record<string, unknown>
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined)
  const name = (locale === 'ar' && page.tenant.name_translations.ar?.trim()) || page.tenant.name
  return {
    name,
    monogram: str('monogram')?.toUpperCase() || deriveMonogram(page.tenant.name),
    logoUrl: logoPublicUrl(b.logo_path),
    assistantName: (locale === 'ar' && str('assistant_name_ar')) || str('assistant_name'),
    themeStyle: buildThemeVariables({ primary: str('primary'), secondary: str('secondary'), accent: str('accent') }),
  }
}
