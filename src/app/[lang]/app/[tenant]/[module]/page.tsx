import { notFound } from 'next/navigation'
import { ModulePlaceholder } from '@/components/app-shell/module-placeholder'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { findNavItem, WORKSPACE_NAV } from '@/lib/navigation/workspace-nav'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Placeholder for workspace modules that are planned but not yet built. */
export default async function WorkspaceModulePage({ params }: PageProps<'/[lang]/app/[tenant]/[module]'>) {
  const { tenant: slug, module } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const { tenant } = ctx

  const item = findNavItem(WORKSPACE_NAV, module)
  if (!item || item.status !== 'planned') notFound()
  requireWorkspaceAccess(ctx, { permission: item.permission, feature: item.feature })

  return (
    <ModulePlaceholder
      title={dict.workspace.items[item.key] ?? item.key}
      description={dict.workspace.descriptions[item.key] ?? ''}
      backHref={localizedPath(locale, `/app/${tenant.slug}`)}
      labels={{
        planned: dict.common.plannedPhase(item.phase),
        notBuilt: dict.workspace.placeholder.notBuilt,
        body: dict.workspace.placeholder.body(item.phase),
        plannedCapabilities: dict.workspace.placeholder.plannedCapabilities,
        back: dict.workspace.placeholder.backToOverview,
      }}
    />
  )
}
