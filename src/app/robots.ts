import type { MetadataRoute } from 'next'
import { publicEnv } from '@/lib/env/public'
import { locales } from '@/lib/i18n/config'

/** Public site and university admissions pages are crawlable; workspaces, console and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  const privatePaths = locales.flatMap((l) => [`/${l}/app`, `/${l}/platform`, `/${l}/invite`, `/${l}/login`, `/${l}/register`, `/${l}/forgot-password`, `/${l}/reset-password`])
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/auth/', ...privatePaths] }],
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
  }
}
