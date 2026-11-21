import { notFound } from 'next/navigation'
import { ModulePlaceholder } from '@/components/app-shell/module-placeholder'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { findNavItem, PLATFORM_NAV } from '@/lib/navigation/workspace-nav'
import { requirePlatformAccess } from '@/lib/tenancy/context'

export default async function PlatformModulePage({ params }: PageProps<'/[lang]/platform/[module]'>) {
  const { module } = await params
  const { locale, dict } = await getI18n()
  await requirePlatformAccess(locale)

  const item = findNavItem(PLATFORM_NAV, module)
  if (!item || item.status !== 'planned') notFound()

  return (
    <ModulePlaceholder
      title={dict.platform.items[item.key] ?? item.key}
      description={dict.platform.descriptions[item.key] ?? ''}
      backHref={localizedPath(locale, '/platform')}
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
