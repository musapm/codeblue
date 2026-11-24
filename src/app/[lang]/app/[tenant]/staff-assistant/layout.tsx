import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/app-shell/page-header'
import { SettingsTabs } from '@/components/app-shell/settings-tabs'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { canUseDigest } from '@/lib/staff/view'
import { getWorkspaceContext, hasWorkspaceFeature, hasWorkspacePermission } from '@/lib/tenancy/context'

/** Staff assistant (Phase 10): Ask, Drafts, Ticket digest (ticket staff) and Settings (assistant.configure). */
export default async function StaffAssistantLayout({ children, params }: LayoutProps<'/[lang]/app/[tenant]/staff-assistant'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const canUse = hasWorkspacePermission(ctx, 'assistant.staff.use')
  const canConfigure = hasWorkspacePermission(ctx, 'assistant.configure')
  if (!hasWorkspaceFeature(ctx, 'staff_assistant') || !(canUse || canConfigure)) notFound()
  const s = dict.staff
  const base = localizedPath(locale, `/app/${slug}/staff-assistant`)

  return (
    <>
      <PageHeader title={s.title} description={s.subtitle} />
      <SettingsTabs
        tabs={[
          ...(canUse
            ? [
                { href: base, label: s.tabs.ask!, exact: true },
                { href: `${base}/drafts`, label: s.tabs.drafts! },
                ...(canUseDigest(ctx) ? [{ href: `${base}/tickets`, label: s.tabs.tickets! }] : []),
              ]
            : []),
          ...(canConfigure ? [{ href: `${base}/settings`, label: s.tabs.settings! }] : []),
        ]}
      />
      <div className="mt-6">{children}</div>
    </>
  )
}
