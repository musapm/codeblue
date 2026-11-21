import type { Metadata } from 'next'
import { AppShell } from '@/components/app-shell/app-shell'
import { buildThemeVariables } from '@/lib/branding/theme'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { buildShellSections, shellLabels } from '@/lib/navigation/build-shell'
import { WORKSPACE_NAV } from '@/lib/navigation/workspace-nav'
import { getWorkspaceContext } from '@/lib/tenancy/context'

// The workspace depends on the session, so this segment is allowed to block on the
// server (no static shell). Resolving the session before streaming starts also means an
// unknown or unauthorized tenant gets a real 404 status (see docs/tenant-isolation.md).
export const instant = false

export const metadata: Metadata = { robots: { index: false } }

export default async function WorkspaceLayout({ children, params }: LayoutProps<'/[lang]/app/[tenant]'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const basePath = localizedPath(locale, `/app/${ctx.tenant.slug}`)

  return (
    <AppShell
      locale={locale}
      basePath={basePath}
      themeStyle={buildThemeVariables(ctx.tenant.colors)}
      sections={buildShellSections(WORKSPACE_NAV, ctx.access, basePath, dict.workspace, dict)}
      identity={{ title: ctx.tenant.name, subtitle: dict.workspace.universityWorkspace, monogram: ctx.tenant.monogram, primary: ctx.tenant.colors.primary }}
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
      previewBanner={ctx.user.isPreview ? dict.workspace.previewBanner : undefined}
      labels={shellLabels(dict, dict.workspace.primaryNav)}
    >
      {children}
    </AppShell>
  )
}
