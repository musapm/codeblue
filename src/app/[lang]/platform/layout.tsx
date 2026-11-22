import type { Metadata } from 'next'
import { AppShell } from '@/components/app-shell/app-shell'
import { platformBranding } from '@/lib/branding/platform'
import { buildThemeVariables } from '@/lib/branding/theme'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { buildShellSections, shellLabels } from '@/lib/navigation/build-shell'
import { PLATFORM_NAV } from '@/lib/navigation/workspace-nav'
import { listWorkspacesForUser, requirePlatformAccess } from '@/lib/tenancy/context'

export const instant = false

export const metadata: Metadata = { robots: { index: false } }

export default async function PlatformLayout({ children }: LayoutProps<'/[lang]/platform'>) {
  const { locale, dict } = await getI18n()
  const { user } = await requirePlatformAccess(locale)
  const { workspaces } = await listWorkspacesForUser(locale)
  const firstWorkspace = workspaces[0]
  const basePath = localizedPath(locale, '/platform')

  return (
    <AppShell
      locale={locale}
      basePath={basePath}
      themeStyle={buildThemeVariables(platformBranding.colors)}
      sections={buildShellSections(PLATFORM_NAV, { kind: 'all' }, basePath, { sections: { main: '' }, items: dict.platform.items }, dict)}
      identity={{ title: platformBranding.name, subtitle: dict.platform.title, monogram: platformBranding.shortName.slice(0, 2).toUpperCase(), primary: platformBranding.colors.secondary }}
      secondaryLink={firstWorkspace ? { href: localizedPath(locale, `/app/${firstWorkspace.slug}`), label: dict.workspace.workspace, kind: 'back' } : undefined}
      user={{ displayName: user.fullName ?? (user.isPreview ? dict.workspace.previewUser : user.email ?? ''), email: user.email }}
      previewBanner={user.isPreview ? dict.workspace.previewBanner : undefined}
      labels={shellLabels(dict, dict.platform.title)}
    >
      {children}
    </AppShell>
  )
}
