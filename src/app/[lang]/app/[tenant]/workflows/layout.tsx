import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/app-shell/page-header'
import { SettingsTabs } from '@/components/app-shell/settings-tabs'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getWorkspaceContext, hasWorkspaceFeature, hasWorkspacePermission } from '@/lib/tenancy/context'

/** Service requests for staff (Phase 11): the queue (processors), forms (form managers), settings (AI). */
export default async function WorkflowsLayout({ children, params }: LayoutProps<'/[lang]/app/[tenant]/workflows'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const canProcess = hasWorkspacePermission(ctx, 'tickets.update')
  const canManage = hasWorkspacePermission(ctx, 'departments.manage')
  const canConfigure = hasWorkspacePermission(ctx, 'assistant.configure')
  if (!hasWorkspaceFeature(ctx, 'workflow_agent') || !(canProcess || canManage || canConfigure)) notFound()
  const q = dict.workflows.queue
  const base = localizedPath(locale, `/app/${slug}/workflows`)

  return (
    <>
      <PageHeader title={q.title} description={q.subtitle} />
      <SettingsTabs
        tabs={[
          ...(canProcess ? [{ href: base, label: q.tabs.queue!, exact: true, also: [`${base}/requests/`] }] : []),
          ...(canManage ? [{ href: `${base}/forms`, label: q.tabs.forms! }] : []),
          ...(canConfigure ? [{ href: `${base}/settings`, label: q.tabs.settings! }] : []),
        ]}
      />
      <div className="mt-6">{children}</div>
    </>
  )
}
