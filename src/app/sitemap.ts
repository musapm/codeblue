import type { MetadataRoute } from 'next'
import { publicEnv } from '@/lib/env/public'
import { locales } from '@/lib/i18n/config'

/**
 * Marketing pages in every language, with language alternates. Universities' public admissions
 * pages are reached through links; listing them would need a database query per request.
 */
const MARKETING_PATHS = ['', '/product', '/features', '/solutions', '/pricing', '/about', '/demo', '/contact', '/privacy', '/terms'] as const

export default function sitemap(): MetadataRoute.Sitemap {
  const site = publicEnv.siteUrl
  return MARKETING_PATHS.flatMap((path) =>
    locales.map((locale) => ({
      url: `${site}/${locale}${path}`,
      alternates: { languages: Object.fromEntries(locales.map((l) => [l, `${site}/${l}${path}`])) },
    })),
  )
}
