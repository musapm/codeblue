import { describe, expect, it } from 'vitest'
import { platformBranding } from '@/lib/branding/platform'
import { isLocale, localeDirection, localizedPath, splitLocaleFromPath, switchLocalePath } from './config'
import { ar } from './dictionaries/ar'
import { en } from './dictionaries/en'
import { negotiateLocale } from './negotiate'

describe('locale helpers', () => {
  it('validates locales and directions', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('ar')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(localeDirection('ar')).toBe('rtl')
    expect(localeDirection('en')).toBe('ltr')
  })

  it('builds and switches localized paths', () => {
    expect(localizedPath('ar', '/')).toBe('/ar')
    expect(localizedPath('en', '/pricing')).toBe('/en/pricing')
    expect(localizedPath('en', 'pricing')).toBe('/en/pricing')
    expect(splitLocaleFromPath('/ar/app/northbridge')).toEqual({ locale: 'ar', rest: '/app/northbridge' })
    expect(splitLocaleFromPath('/pricing')).toEqual({ locale: null, rest: '/pricing' })
    expect(switchLocalePath('/en/pricing', 'ar')).toBe('/ar/pricing')
    expect(switchLocalePath('/en', 'ar')).toBe('/ar')
  })
})

describe('negotiateLocale', () => {
  it('prefers a valid cookie', () => {
    expect(negotiateLocale('en-US', 'ar')).toBe('ar')
    expect(negotiateLocale('ar', 'xx')).toBe('ar')
  })

  it('honours Accept-Language quality values and regions', () => {
    expect(negotiateLocale('fr-FR,ar-SD;q=0.8,en;q=0.5')).toBe('ar')
    expect(negotiateLocale('en;q=0.4, ar;q=0.9')).toBe('ar')
    expect(negotiateLocale('de, fr')).toBe('en')
    expect(negotiateLocale(null)).toBe('en')
    expect(negotiateLocale('ar;q=0')).toBe('en')
  })
})

/** Recursively collect key paths so Record<string, string> sections are also compared. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => keyPaths(item, `${prefix}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

describe('dictionaries', () => {
  const english = en(platformBranding)
  const arabic = ar(platformBranding)

  it('Arabic has exactly the same keys as English', () => {
    expect(keyPaths(arabic).sort()).toEqual(keyPaths(english).sort())
  })

  it('has no empty strings except intentional blanks', () => {
    const blanks = keyPaths(arabic).filter((path) => {
      const value = path.split(/\.|\[|\]/).filter(Boolean).reduce<unknown>((obj, k) => (obj as Record<string, unknown> | undefined)?.[k], arabic)
      return typeof value === 'string' && value.trim() === ''
    })
    expect(blanks).toEqual(['workspace.sections.main'])
  })

  it('uses the configurable platform name rather than a hardcoded one', () => {
    const custom = en({ ...platformBranding, name: 'Campus Copilot' })
    expect(custom.footer.rights(2026)).toContain('Campus Copilot')
    expect(ar({ ...platformBranding, name: 'Campus Copilot' }).auth.sidePanelTitle).toContain('Campus Copilot')
  })
})
