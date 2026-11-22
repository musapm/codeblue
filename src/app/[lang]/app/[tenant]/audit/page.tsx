import { PageHeader } from '@/components/app-shell/page-header'
import { AuditTable } from '@/components/management/audit-table'
import { Card, CardContent } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listAuditLogs, listMembers } from '@/lib/management/queries'
import { auditLabels, toAuditView } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function WorkspaceAuditPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/audit'>) {
  const { tenant: slug } = await params
  const { before } = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'audit.read' })
  const a = dict.management.audit

  const beforeId = typeof before === 'string' && /^\d{1,18}$/.test(before) ? Number(before) : undefined
  const tenantId = ctx.tenantId
  const [audit, members] = tenantId
    ? await Promise.all([listAuditLogs({ tenantId, beforeId }), hasWorkspacePermission(ctx, 'members.read') ? listMembers(slug) : Promise.resolve([])])
    : [{ rows: [], nextBeforeId: null }, []]
  const names = new Map(members.map((m) => [m.user_id, m.full_name || m.email || m.user_id.slice(0, 8)]))
  const base = localizedPath(locale, `/app/${slug}/audit`)

  return (
    <>
      <PageHeader title={a.title} description={a.subtitle} />
      <Card>
        <CardContent>
          <AuditTable
            rows={toAuditView(dict, locale, audit.rows, names)}
            labels={auditLabels(dict)}
            olderHref={audit.nextBeforeId ? `${base}?before=${audit.nextBeforeId}` : undefined}
            newestHref={beforeId ? base : undefined}
          />
        </CardContent>
      </Card>
    </>
  )
}
