import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm } from '@/components/management/action-form'
import { DefinitionFields } from '@/components/workflows/definition-fields'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { departmentOptions } from '@/lib/staff/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { saveDefinitionAction } from '@/lib/workflows/actions'
import { listDefinitions } from '@/lib/workflows/queries'
import { formTitle } from '@/lib/workflows/view'

const STATUS_BADGE = { draft: 'neutral', active: 'success', archived: 'outline' } as const

/** Request forms: list and create (form managers: departments.manage). */
export default async function WorkflowFormsPage({ params }: PageProps<'/[lang]/app/[tenant]/workflows/forms'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'departments.manage', feature: 'workflow_agent' })
  const f = dict.workflows.forms
  const { canWrite, notice } = writeMode(ctx, dict)
  const base = localizedPath(locale, `/app/${slug}/workflows/forms`)
  const live = !!ctx.tenantId && !ctx.user.isPreview
  const [definitions, departments] = live ? await Promise.all([listDefinitions(ctx.tenantId!), listDepartments(ctx.tenantId!)]) : [[], []]
  const deptName = new Map(departments.map((d) => [d.id, (locale === 'ar' && d.nameAr) || d.name]))

  return (
    <div className="space-y-6">
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>{f.title}</CardTitle>
          <CardDescription>{f.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          {definitions.length === 0 ? (
            <EmptyState icon={<ClipboardList />} title={f.empty} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {[f.columns.title, f.columns.department, f.columns.status, f.columns.version].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {definitions.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Link href={`${base}/${d.id}`} className="font-medium text-primary underline-offset-4 hover:underline" dir="auto">
                          {formTitle(locale, d)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{d.department_id ? (deptName.get(d.department_id) ?? '') : f.generalQueue}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          <Badge variant={STATUS_BADGE[d.status as keyof typeof STATUS_BADGE] ?? 'neutral'}>{f.statuses[d.status] ?? d.status}</Badge>
                          {d.draft ? <Badge variant="warning">{f.draftPending}</Badge> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{d.versionNo ? f.version(d.versionNo) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{f.createTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveDefinitionAction} hidden={{ tenant: slug, locale }} messages={formMessages(dict)} showSuccess={false}>
              <DefinitionFields dict={dict} departments={departmentOptions(locale, departments)} />
              <SubmitButton pendingLabel={dict.management.saving}>{f.createSubmit}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
