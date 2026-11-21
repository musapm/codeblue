import { defaultLocale, isLocale, locales, type Locale } from './config'

/**
 * Choose a locale for an un-prefixed request: explicit cookie → Accept-Language → default.
 * Small, dependency-free parser that understands quality values (`ar;q=0.9`) and region
 * subtags (`ar-SD` → `ar`).
 */
export function negotiateLocale(acceptLanguage: string | null | undefined, cookieLocale?: string | null): Locale {
  if (isLocale(cookieLocale)) return cookieLocale
  if (!acceptLanguage) return defaultLocale

  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1
      return { base: tag.toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0, index }
    })
    .filter((entry) => entry.base && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)

  for (const { base } of ranked) {
    if ((locales as readonly string[]).includes(base)) return base as Locale
  }
  return defaultLocale
}
