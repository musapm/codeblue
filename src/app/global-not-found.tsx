import type { Metadata } from 'next'
import Link from 'next/link'
import { platformBranding } from '@/lib/branding/platform'
import { buildThemeVariables } from '@/lib/branding/theme'
import { plexArabic, plexSans } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  title: `Page not found · ${platformBranding.name}`,
  robots: { index: false },
}

/**
 * 404 for URLs that match no route at all. The root layout lives under `[lang]`, so this
 * page renders its own document and shows both languages.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexArabic.variable} h-full`}>
      <body className="flex min-h-full items-center justify-center bg-canvas p-6 antialiased" style={buildThemeVariables(platformBranding.colors)}>
        <main className="w-full max-w-md rounded-card border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-primary">404</p>
          <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">The page you are looking for does not exist.</p>
          <p lang="ar" dir="rtl" className="mt-4 text-sm text-muted-foreground">
            الصفحة التي تبحث عنها غير موجودة.
          </p>
          <div className="mt-6 flex justify-center gap-3 text-sm font-medium">
            <Link className="text-primary hover:underline" href="/en">
              Home
            </Link>
            <span aria-hidden className="text-border">
              |
            </span>
            <Link className="text-primary hover:underline" href="/ar" lang="ar">
              الرئيسية
            </Link>
          </div>
        </main>
      </body>
    </html>
  )
}
