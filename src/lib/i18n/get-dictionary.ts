import { platformBranding } from '@/lib/branding/platform'
import type { Locale } from './config'
import { ar } from './dictionaries/ar'
import { en, type Dictionary } from './dictionaries/en'

const factories: Record<Locale, typeof en> = { en, ar }
const cache = new Map<Locale, Dictionary>()

/** UI strings for a locale. Server Components pass the slices they need to Client Components. */
export function getDictionary(locale: Locale): Dictionary {
  let dict = cache.get(locale)
  if (!dict) {
    dict = factories[locale](platformBranding)
    cache.set(locale, dict)
  }
  return dict
}

export type { Dictionary }
