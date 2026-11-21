import type { Metadata } from 'next'
import { getMarketingContent, type MarketingPageKey } from '@/content/marketing'
import { localizedPath, locales } from '@/lib/i18n/config'
import { getLocale } from '@/lib/i18n/server'

/** Per-page metadata with language alternates for SEO. */
export async function marketingMetadata(page: MarketingPageKey, path: string): Promise<Metadata> {
  const locale = await getLocale()
  const { title, description } = getMarketingContent(locale).meta[page]
  return {
    title: page === 'home' ? { absolute: title } : title,
    description,
    alternates: {
      canonical: localizedPath(locale, path),
      languages: Object.fromEntries(locales.map((l) => [l, localizedPath(l, path)])),
    },
    openGraph: { title, description },
  }
}
