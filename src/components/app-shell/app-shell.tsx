'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsUpDown, Eye, LogOut, Menu, ShieldCheck, Check, ArrowLeft } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { signOut } from '@/lib/auth/actions'
import type { Locale } from '@/lib/i18n/config'
import type { NavIconName, NavStatus } from '@/lib/navigation/workspace-nav'
import { cn } from '@/lib/utils'
import { NAV_ICONS } from './nav-icons'

export type ShellNavItem = { key: string; href: string; label: string; icon: NavIconName; status: NavStatus; phase: number; plannedLabel?: string }
export type ShellNavSection = { key: string; label: string; items: ShellNavItem[] }
export type ShellWorkspace = { slug: string; name: string; monogram: string; href: string; primary: string }

export type AppShellProps = {
  locale: Locale
  /** Root of this area; the overview link matches it exactly. */
  basePath: string
  sections: ShellNavSection[]
  identity: { title: string; subtitle: string; monogram: string; primary: string }
  workspaces?: ShellWorkspace[]
  currentSlug?: string
  secondaryLink?: { href: string; label: string; kind: 'console' | 'back' }
  user: { displayName: string; email: string | null }
  previewBanner?: string
  themeStyle?: CSSProperties
  labels: {
    navigation: string
    openMenu: string
    closeMenu: string
    language: string
    switchWorkspace: string
    account: string
    signedInAs: string
    signOut: string
  }
  children: ReactNode
}

function NavList({ sections, basePath, onNavigate, labels }: Pick<AppShellProps, 'sections' | 'basePath' | 'labels'> & { onNavigate?: () => void }) {
  const pathname = usePathname() ?? ''
  const isActive = (href: string) => (href === basePath ? pathname === basePath : pathname === href || pathname.startsWith(`${href}/`))

  return (
    <nav aria-label={labels.navigation} className="space-y-5">
      {sections.map((section) => (
        <div key={section.key}>
          {section.label ? <p className="mb-1.5 px-3 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">{section.label}</p> : null}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = NAV_ICONS[item.icon]
              const active = isActive(item.href)
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors',
                      active ? 'bg-primary-subtle font-medium text-primary-subtle-foreground' : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon aria-hidden className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.status === 'planned' ? (
                      <span className="text-[0.7rem] font-medium text-muted-foreground tabular-nums" title={item.plannedLabel}>
                        P{item.phase}
                        <span className="sr-only"> — {item.plannedLabel}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function IdentityHeader({ identity, workspaces, currentSlug, labels }: Pick<AppShellProps, 'identity' | 'workspaces' | 'currentSlug' | 'labels'>) {
  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: identity.primary }}>
        {identity.monogram}
      </span>
      <span className="min-w-0 flex-1 text-start">
        <span className="block truncate text-sm font-semibold text-foreground">{identity.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{identity.subtitle}</span>
      </span>
    </>
  )

  if (!workspaces || workspaces.length < 2) return <div className="flex items-center gap-3 px-2 py-1.5">{content}</div>

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted" aria-label={labels.switchWorkspace}>
        {content}
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{labels.switchWorkspace}</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.slug} asChild>
            <Link href={w.href}>
              <span className="flex size-6 items-center justify-center rounded text-[0.6rem] font-semibold text-white" style={{ backgroundColor: w.primary }}>
                {w.monogram}
              </span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.slug === currentSlug ? <Check aria-hidden className="text-primary" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SecondaryLink({ link, onNavigate }: { link: NonNullable<AppShellProps['secondaryLink']>; onNavigate?: () => void }) {
  const Icon = link.kind === 'console' ? ShieldCheck : ArrowLeft
  return (
    <Link href={link.href} onClick={onNavigate} className="flex h-9 items-center gap-2.5 rounded-md px-3 text-sm text-foreground/80 hover:bg-muted hover:text-foreground">
      <Icon aria-hidden className="size-4 text-muted-foreground rtl:-scale-x-100" />
      {link.label}
    </Link>
  )
}

export function AppShell(props: AppShellProps) {
  const { locale, labels, user } = props
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div style={props.themeStyle} className="min-h-screen bg-canvas">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-border bg-background lg:flex">
          <div className="border-b border-border p-3">
            <IdentityHeader identity={props.identity} workspaces={props.workspaces} currentSlug={props.currentSlug} labels={labels} />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <NavList sections={props.sections} basePath={props.basePath} labels={labels} />
          </div>
          {props.secondaryLink ? (
            <div className="border-t border-border p-3">
              <SecondaryLink link={props.secondaryLink} />
            </div>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Inside the content column so the sticky full-height sidebar is never pushed down. */}
          {props.previewBanner ? (
            <div role="note" className="flex items-center justify-center gap-2 bg-warning-subtle px-4 py-2 text-center text-xs font-medium text-warning">
              <Eye aria-hidden className="size-3.5 shrink-0" />
              {props.previewBanner}
            </div>
          ) : null}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="-ms-2 inline-flex size-10 items-center justify-center rounded-md hover:bg-muted lg:hidden"
            >
              <Menu aria-hidden className="size-5" />
              <span className="sr-only">{labels.openMenu}</span>
            </button>
            <span className="truncate text-sm font-semibold lg:hidden">{props.identity.title}</span>

            <div className="ms-auto flex items-center gap-1">
              <LanguageSwitcher locale={locale} label={labels.language} />
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-full p-1 hover:bg-muted" aria-label={labels.account}>
                  <Avatar label={user.displayName} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="space-y-0.5">
                    <span className="block text-[0.7rem]">{labels.signedInAs}</span>
                    <span className="block truncate text-sm font-semibold text-foreground">{user.displayName}</span>
                    {user.email ? (
                      <span className="block truncate font-normal" dir="ltr">
                        {user.email}
                      </span>
                    ) : null}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <form action={signOut}>
                    <input type="hidden" name="locale" value={locale} />
                    <DropdownMenuItem asChild>
                      <button type="submit" className="w-full">
                        <LogOut aria-hidden className="rtl:-scale-x-100" />
                        {labels.signOut}
                      </button>
                    </DropdownMenuItem>
                  </form>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-6xl">{props.children}</div>
          </main>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen} title={labels.navigation} closeLabel={labels.closeMenu}>
        <div className="mb-4 border-b border-border pb-3">
          <IdentityHeader identity={props.identity} workspaces={props.workspaces} currentSlug={props.currentSlug} labels={labels} />
        </div>
        <NavList sections={props.sections} basePath={props.basePath} labels={labels} onNavigate={() => setMobileOpen(false)} />
        {props.secondaryLink ? (
          <div className="mt-4 border-t border-border pt-3">
            <SecondaryLink link={props.secondaryLink} onNavigate={() => setMobileOpen(false)} />
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}
