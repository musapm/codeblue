import type { Metadata, Viewport } from 'next'
import { lang } from 'next/root-params'
import { notFound } from 'next/navigation'
import { platformBranding } from '@/lib/branding/platform'
import { buildThemeVariables } from '@/lib/branding/theme'
import { publicEnv } from '@/lib/env/public'
import { isLocale, localeMeta, locales } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { plexArabic, plexSans } from '../fonts'
import '../globals.css'

export function generateStaticParams() {
  return locales.map((locale) => ({ lang: locale }))
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await lang()
  return {
    metadataBase: new URL(publicEnv.siteUrl),
    title: { default: platformBranding.name, template: `%s · ${platformBranding.name}` },
    applicationName: platformBranding.name,
    alternates: { languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])) },
    openGraph: { siteName: platformBranding.name, locale: isLocale(locale) ? localeMeta[locale].htmlLang : 'en' },
  }
}

export const viewport: Viewport = {
  themeColor: platformBranding.colors.primary,
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: LayoutProps<'/[lang]'>) {
  const locale = await lang()
  // The proxy only forwards supported locales; this is a second line of defense.
  if (!isLocale(locale)) notFound()
  const dict = getDictionary(locale)

  return (
    <html lang={localeMeta[locale].htmlLang} dir={localeMeta[locale].dir} className={`${plexSans.variable} ${plexArabic.variable} h-full`}>
      <body className="min-h-full antialiased" style={buildThemeVariables(platformBranding.colors)}>
        <a
          href="#main"
          className="sr-only z-[100] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
        >
          {dict.common.skipToContent}
        </a>
        {children}
      </body>
    </html>
  )
}
