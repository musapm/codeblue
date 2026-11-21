'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import { buttonClasses } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { localizedPath, type Locale } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

export type HeaderNavItem = { href: string; label: string }

type SiteHeaderProps = {
  locale: Locale
  logo: ReactNode
  items: HeaderNavItem[]
  labels: { main: string; signIn: string; requestDemo: string; language: string; openMenu: string; closeMenu: string }
}

export function SiteHeader({ locale, logo, items, labels }: SiteHeaderProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`)

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="container-page flex h-16 items-center gap-6">
        <Link href={localizedPath(locale, '/')} className="rounded-md" aria-label={labels.main}>
          {logo}
        </Link>

        <nav aria-label={labels.main} className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
                    isActive(item.href) ? 'text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto hidden items-center gap-2 lg:flex">
          <LanguageSwitcher locale={locale} label={labels.language} />
          <Link href={localizedPath(locale, '/login')} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            {labels.signIn}
          </Link>
          <Link href={localizedPath(locale, '/contact')} className={buttonClasses({ size: 'sm' })}>
            {labels.requestDemo}
          </Link>
        </div>

        <div className="ms-auto flex items-center gap-1 lg:hidden">
          <LanguageSwitcher locale={locale} label={labels.language} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            className="inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-muted"
          >
            <Menu aria-hidden className="size-5" />
            <span className="sr-only">{labels.openMenu}</span>
          </button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen} title={labels.main} closeLabel={labels.closeMenu} side="end">
        <nav aria-label={labels.main}>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex h-11 items-center rounded-md px-3 text-sm font-medium',
                    isActive(item.href) ? 'bg-primary-subtle text-primary-subtle-foreground' : 'text-foreground hover:bg-muted',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 grid gap-2 border-t border-border pt-6">
          <Link href={localizedPath(locale, '/contact')} onClick={() => setOpen(false)} className={buttonClasses({ className: 'w-full' })}>
            {labels.requestDemo}
          </Link>
          <Link
            href={localizedPath(locale, '/login')}
            onClick={() => setOpen(false)}
            className={buttonClasses({ variant: 'secondary', className: 'w-full' })}
          >
            {labels.signIn}
          </Link>
        </div>
      </Sheet>
    </header>
  )
}
