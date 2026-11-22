import { Archive, ArchiveRestore, Building2 } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { ActionButton } from '@/components/management/action-form'
import { DepartmentForm, type DepartmentFormLabels } from '@/components/management/department-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments, listMembers } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { setDepartmentArchived } from '@/lib/management/workspace-actions'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function DepartmentsPage({ params }: PageProps<'/[lang]/app/[tenant]/departments'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'departments.manage' })
  const m = dict.management
  const t = m.departments
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)

  const tenantId = ctx.tenantId
  const [departments, members] = tenantId
    ? await Promise.all([listDepartments(tenantId), hasWorkspacePermission(ctx, 'members.read') ? listMembers(slug) : Promise.resolve([])])
    : [[], []]
  const memberCount = (id: string) => members.filter((mm) => mm.department_ids.includes(id)).length
  const hidden = { tenant: slug, tenantId: tenantId ?? undefined, locale }
  const labels: DepartmentFormLabels = {
    name: t.name,
    nameAr: t.nameAr,
    slug: t.slug,
    slugHint: t.slugHint,
    email: t.email,
    optional: dict.common.optional,
    submit: t.submitCreate,
    saving: m.saving,
  }
  const sorted = [...departments].sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)))

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t.list}</CardTitle>
          </CardHeader>
          <CardContent>
            {sorted.length === 0 ? (
              <EmptyState icon={<Building2 />} title={t.empty} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {sorted.map((d) => (
                  <li key={d.id} className="space-y-3 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {(locale === 'ar' && d.nameAr) || d.name}
                          {d.archivedAt ? <Badge variant="warning">{t.archived}</Badge> : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground" dir="ltr">
                          {d.slug}
                          {d.email ? ` · ${d.email}` : ''}
                        </p>
                      </div>
                      {members.length > 0 ? <span className="text-xs text-muted-foreground">{t.members(memberCount(d.id))}</span> : null}
                      {canWrite ? (
                        <ActionButton
                          action={setDepartmentArchived}
                          hidden={{ ...hidden, departmentId: d.id, archived: d.archivedAt ? 'false' : 'true' }}
                          messages={messages}
                          confirmMessage={d.archivedAt ? undefined : m.confirm.archive}
                          label={d.archivedAt ? t.restore : t.archive}
                          icon={d.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                        />
                      ) : null}
                    </div>
                    {canWrite && !d.archivedAt ? (
                      <details className="rounded-lg border border-border bg-muted/30 open:bg-background">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{m.edit}</summary>
                        <div className="border-t border-border p-3">
                          <DepartmentForm hidden={hidden} initial={d} labels={{ ...labels, submit: t.submitUpdate }} messages={messages} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {canWrite ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{t.create}</CardTitle>
            </CardHeader>
            <CardContent>
              <DepartmentForm hidden={hidden} labels={labels} messages={messages} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
