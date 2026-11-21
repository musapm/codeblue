'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Languages } from 'lucide-react'
import { LOCALE_COOKIE, localeMeta, locales, switchLocalePath, type Locale } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

/** Links to the same page in the other language and remembers the choice in a cookie. */
export function LanguageSwitcher({ locale, label, className }: { locale: Locale; label: string; className?: string }) {
  const pathname = usePathname() ?? `/${locale}`
  const targets = locales.filter((l) => l !== locale)

  return (
    <div className={cn('flex items-center', className)}>
      {targets.map((target) => (
        <Link
          key={target}
          href={switchLocalePath(pathname, target)}
          hrefLang={localeMeta[target].htmlLang}
          lang={localeMeta[target].htmlLang}
          aria-label={`${label}: ${localeMeta[target].nativeName}`}
          onClick={() => {
            document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Languages aria-hidden className="size-4" />
          {localeMeta[target].nativeName}
        </Link>
      ))}
    </div>
  )
}
