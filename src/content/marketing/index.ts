import { platformBranding } from '@/lib/branding/platform'
import type { Locale } from '@/lib/i18n/config'
import { arMarketing } from './ar'
import { enMarketing } from './en'
import type { MarketingContent } from './types'

const cache = new Map<Locale, MarketingContent>()

export function getMarketingContent(locale: Locale): MarketingContent {
  let content = cache.get(locale)
  if (!content) {
    content = (locale === 'ar' ? arMarketing : enMarketing)(platformBranding)
    cache.set(locale, content)
  }
  return content
}

export type { MarketingContent, MarketingPageKey } from './types'
