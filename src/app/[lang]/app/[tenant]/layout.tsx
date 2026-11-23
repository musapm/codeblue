import type { Metadata } from 'next'
import { Ban } from 'lucide-react'
import { StatusScreen } from '@/components/app-shell/status-screen'
import { AppShell } from '@/components/app-shell/app-shell'
import { NotificationBell } from '@/components/tickets/notification-bell'
import { buildThemeVariables } from '@/lib/branding/theme'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { buildShellSections, shellLabels } from '@/lib/navigation/build-shell'
import { canSeeNavItem, WORKSPACE_NAV } from '@/lib/navigation/workspace-nav'
import { unreadNotificationCount } from '@/lib/tickets/queries'
import { getWorkspaceContext } from '@/lib/tenancy/context'
import { isOperating } from '@/lib/tenancy/mappers'

// The workspace depends on the session, so this segment is allowed to block on the
// server. Unknown and unauthorized tenants render "not found" identically (the HTTP status
// stays 200 under Cache Components streaming; content is never rendered — docs/testing.md).
export const instant = false

export const metadata: Metadata = { robots: { index: false } }

export default async function WorkspaceLayout({ children, params }: LayoutProps<'/[lang]/app/[tenant]'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const basePath = localizedPath(locale, `/app/${ctx.tenant.slug}`)

  // Suspended/archived university: members keep a way out, but no workspace.
  if (!isOperating(ctx.tenant.status) && ctx.accessVia === 'membership') {
    return (
      <StatusScreen
        locale={locale}
        dict={dict}
        icon={<Ban />}
        title={dict.workspace.unavailable.title}
        body={dict.workspace.unavailable.body}
        email={ctx.user.email}
      />
    )
  }

  // Ticket notifications (Phase 7): only where the university has ticketing. Fails soft.
  const showBell = canSeeNavItem({ key: '', segment: '', icon: 'overview', status: 'available', phase: 7, feature: 'ticketing' }, ctx.access)
  const unread = showBell && ctx.tenantId ? await unreadNotificationCount(ctx.tenantId) : null
  const bell = showBell ? (
    <NotificationBell href={`${basePath}/notifications`} count={unread} label={dict.tickets.notifications.bell(unread ?? 0)} />
  ) : undefined

  const banner = ctx.user.isPreview
    ? dict.workspace.previewBanner
    : ctx.accessVia === 'support'
      ? dict.workspace.supportAccessBanner
      : undefined

  return (
    <AppShell
      locale={locale}
      basePath={basePath}
      themeStyle={buildThemeVariables(ctx.tenant.colors)}
      sections={buildShellSections(WORKSPACE_NAV, ctx.access, basePath, dict.workspace, dict)}
      identity={{ title: ctx.tenant.name, subtitle: dict.workspace.universityWorkspace, monogram: ctx.tenant.monogram, primary: ctx.tenant.colors.primary, logoUrl: ctx.tenant.logoUrl }}
      workspaces={ctx.memberships.map((w) => ({
        slug: w.slug,
        name: w.name,
        monogram: w.monogram,
        primary: w.colors.primary,
        href: localizedPath(locale, `/app/${w.slug}`),
      }))}
      currentSlug={ctx.tenant.slug}
      secondaryLink={ctx.canAccessPlatformConsole ? { href: localizedPath(locale, '/platform'), label: dict.workspace.platformConsole, kind: 'console' } : undefined}
      user={{ displayName: ctx.user.fullName ?? (ctx.user.isPreview ? dict.workspace.previewUser : ctx.user.email ?? ''), email: ctx.user.email }}
      previewBanner={banner}
      headerExtra={bell}
      labels={shellLabels(dict, dict.workspace.primaryNav)}
    >
      {children}
    </AppShell>
  )
}
