import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Languages, Mail } from 'lucide-react'
import type { CSSProperties } from 'react'
import { publicBranding } from '@/lib/admissions/public-view'
import { getPublicAdmissions } from '@/lib/admissions/visitor'
import { localeMeta, localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'

// Public, but read at request time (published programs and settings change).
export const instant = false

export async function generateMetadata({ params }: LayoutProps<'/[lang]/admissions/[tenant]'>): Promise<Metadata> {
  const { tenant } = await params
  const { locale, dict } = await getI18n()
  const page = await getPublicAdmissions(tenant)
  if (!page) return { robots: { index: false } }
  const { name } = publicBranding(page, locale)
  return { title: dict.admissions.public.metaTitle(name), description: dict.admissions.public.metaDescription(name) }
}

export default async function PublicAdmissionsLayout({ children, params }: LayoutProps<'/[lang]/admissions/[tenant]'>) {
  const { tenant } = await params
  const { locale, dict } = await getI18n()
  const page = await getPublicAdmissions(tenant)
  if (!page) notFound()
  const brand = publicBranding(page, locale)
  const other = locale === 'ar' ? 'en' : 'ar'
  const p = dict.admissions.public

  return (
    <div style={brand.themeStyle as CSSProperties} className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href={localizedPath(locale, `/admissions/${page.tenant.slug}`)} className="flex min-w-0 items-center gap-3">
            {brand.logoUrl ? (
              // Tenant logos come from Supabase Storage (allowed by the CSP img-src), ≤ 1 MB.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="size-10 rounded-lg bg-white object-contain p-0.5" />
            ) : (
              <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                {brand.monogram}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{brand.name}</span>
              <span className="block text-xs text-muted-foreground">{p.eyebrow}</span>
            </span>
          </Link>
          <Link href={localizedPath(other, `/admissions/${page.tenant.slug}`)} hrefLang={other} className="ms-auto inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Languages aria-hidden className="size-4" />
            {localeMeta[other].nativeName}
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          {page.settings.contact_email ? (
            <p className="flex items-center gap-1.5">
              <Mail aria-hidden className="size-3.5" />
              <a href={`mailto:${page.settings.contact_email}`} className="hover:text-foreground" dir="ltr">
                {p.contact(page.settings.contact_email)}
              </a>
            </p>
          ) : null}
          <p>{p.accuracy}</p>
        </div>
      </footer>
    </div>
  )
}
