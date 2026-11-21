export const locales = ['en', 'ar'] as const
export type Locale = (typeof locales)[number]
export type Direction = 'ltr' | 'rtl'

export const defaultLocale: Locale = 'en'
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export const localeMeta: Record<Locale, { name: string; nativeName: string; dir: Direction; htmlLang: string }> = {
  en: { name: 'English', nativeName: 'English', dir: 'ltr', htmlLang: 'en' },
  ar: { name: 'Arabic', nativeName: 'العربية', dir: 'rtl', htmlLang: 'ar' },
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}

export function localeDirection(locale: Locale): Direction {
  return localeMeta[locale].dir
}

/** Build an internal link with the locale prefix: `localizedPath('ar', '/pricing')` → `/ar/pricing`. */
export function localizedPath(locale: Locale, path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

/** Strip a leading locale segment: `/ar/pricing` → `{ locale: 'ar', rest: '/pricing' }`. */
export function splitLocaleFromPath(pathname: string): { locale: Locale | null; rest: string } {
  const segments = pathname.split('/')
  const first = segments[1]
  if (isLocale(first)) {
    const rest = `/${segments.slice(2).join('/')}`
    return { locale: first, rest: rest === '/' ? '/' : rest.replace(/\/+$/, '') || '/' }
  }
  return { locale: null, rest: pathname || '/' }
}

/** Same page in another language. */
export function switchLocalePath(pathname: string, target: Locale): string {
  return localizedPath(target, splitLocaleFromPath(pathname).rest)
}
