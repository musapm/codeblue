import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import { localizedPath, type Locale } from '@/lib/i18n/config'

export function SiteFooter({ locale, dict, year }: { locale: Locale; dict: Dictionary; year: number }) {
  const p = (path: string) => localizedPath(locale, path)
  const columns = [
    {
      heading: dict.footer.productHeading,
      links: [
        { href: p('/product'), label: dict.nav.product },
        { href: p('/features'), label: dict.nav.features },
        { href: p('/solutions'), label: dict.nav.solutions },
        { href: p('/pricing'), label: dict.nav.pricing },
      ],
    },
    {
      heading: dict.footer.companyHeading,
      links: [
        { href: p('/about'), label: dict.nav.about },
        { href: p('/demo'), label: dict.nav.demo },
        { href: p('/contact'), label: dict.nav.contact },
      ],
    },
    {
      heading: dict.footer.legalHeading,
      links: [
        { href: p('/privacy'), label: dict.footer.privacy },
        { href: p('/terms'), label: dict.footer.terms },
      ],
    },
  ]

  return (
    <footer className="border-t border-border bg-canvas">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs space-y-3">
          <Logo />
          <p className="text-sm leading-relaxed text-muted-foreground">{dict.footer.tagline}</p>
        </div>
        {columns.map((column) => (
          <div key={column.heading}>
            <h2 className="text-xs font-semibold tracking-wide text-foreground uppercase">{column.heading}</h2>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{dict.footer.rights(year)}</p>
          <p>{dict.footer.fictionalNotice}</p>
        </div>
      </div>
    </footer>
  )
}
