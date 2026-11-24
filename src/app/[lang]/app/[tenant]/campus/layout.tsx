import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/app-shell/page-header'
import { SettingsTabs } from '@/components/app-shell/settings-tabs'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getWorkspaceContext, hasWorkspaceFeature, hasWorkspacePermission } from '@/lib/tenancy/context'

/** Campus (Phase 12): the directory and map for members; managing locations; AI settings. */
export default async function CampusLayout({ children, params }: LayoutProps<'/[lang]/app/[tenant]/campus'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  if (!hasWorkspaceFeature(ctx, 'campus_assistant')) notFound()
  const c = dict.campus
  const base = localizedPath(locale, `/app/${slug}/campus`)
  const canManage = hasWorkspacePermission(ctx, 'campus.manage')
  const canConfigure = hasWorkspacePermission(ctx, 'assistant.configure')

  return (
    <>
      <PageHeader title={c.title} description={c.subtitle} />
      {canManage || canConfigure ? (
        <SettingsTabs
          tabs={[
            { href: base, label: c.tabs.directory!, exact: true },
            ...(canManage ? [{ href: `${base}/manage`, label: c.tabs.manage! }] : []),
            ...(canConfigure ? [{ href: `${base}/settings`, label: c.tabs.settings! }] : []),
          ]}
        />
      ) : null}
      <div className="mt-6">{children}</div>
    </>
  )
}
