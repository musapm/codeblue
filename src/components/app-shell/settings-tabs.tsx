'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/** `also`: extra path prefixes that belong to the tab (e.g. detail pages of an exact tab). */
export function SettingsTabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean; also?: string[] }[] }) {
  const pathname = usePathname() ?? ''
  return (
    <nav className="border-b border-border">
      <ul className="-mb-px flex gap-6">
        {tabs.map((tab) => {
          const active = (tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)) || (tab.also ?? []).some((p) => pathname.startsWith(p))
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center border-b-2 text-sm font-medium transition-colors',
                  active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
