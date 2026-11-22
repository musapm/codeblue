import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/app-shell/page-header'
import { AuditTable } from '@/components/management/audit-table'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listAuditLogs, listPlatformStaff, listPlatformTenants } from '@/lib/management/queries'
import { auditLabels, toAuditView } from '@/lib/management/view'
import { requirePlatformAccess } from '@/lib/tenancy/context'

export default async function PlatformAuditPage({ searchParams }: PageProps<'/[lang]/platform/audit'>) {
  const { before } = await searchParams
  const { locale, dict } = await getI18n()
  const { user, role } = await requirePlatformAccess(locale)
  // Row Level Security shows the full trail to platform owners/admins only.
  if (role !== 'owner' && role !== 'admin') notFound()
  const a = dict.management.platform.audit

  const beforeId = typeof before === 'string' && /^\d{1,18}$/.test(before) ? Number(before) : undefined
  const [audit, staff, tenants] = user.isPreview
    ? [{ rows: [], nextBeforeId: null }, [], []]
    : await Promise.all([listAuditLogs({ beforeId }), listPlatformStaff(), listPlatformTenants()])
  // Only platform staff names are resolved here; tenant members stay pseudonymous (ADR-014).
  const names = new Map(staff.map((s) => [s.user_id, s.full_name || s.email || s.user_id.slice(0, 8)]))
  const tenantSlugs = new Map(tenants.map((t) => [t.id, t.slug]))
  const base = localizedPath(locale, '/platform/audit')

  return (
    <>
      <PageHeader title={a.title} description={a.subtitle} />
      {user.isPreview ? (
        <Alert variant="info" className="mb-6">
          {dict.management.previewNotice}
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          <AuditTable
            rows={toAuditView(dict, locale, audit.rows, names, tenantSlugs)}
            labels={auditLabels(dict)}
            showTenant
            olderHref={audit.nextBeforeId ? `${base}?before=${audit.nextBeforeId}` : undefined}
            newestHref={beforeId ? base : undefined}
          />
        </CardContent>
      </Card>
    </>
  )
}
