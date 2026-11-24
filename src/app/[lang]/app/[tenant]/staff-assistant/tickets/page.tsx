import { DigestPanel } from '@/components/staff/digest'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formMessages } from '@/lib/management/view'
import { DIGEST_SCOPES } from '@/lib/staff/schemas'
import { getStaffStatus } from '@/lib/staff/queries'
import { canUseDigest, departmentOptions, staffUnavailable } from '@/lib/staff/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** AI digest of the open tickets the staff member works (staff_ticket_digest_source decides which). */
export default async function StaffTicketDigestPage({ params }: PageProps<'/[lang]/app/[tenant]/staff-assistant/tickets'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'assistant.staff.use', feature: 'staff_assistant' })
  const s = dict.staff
  const d = s.digest

  if (!canUseDigest(ctx)) {
    return <Alert variant="info">{d.noAccess}</Alert>
  }

  const live = !ctx.user.isPreview && !!ctx.tenantId && ctx.accessVia !== 'support'
  const [status, departments] = live ? await Promise.all([getStaffStatus(slug), listDepartments(ctx.tenantId!)]) : [null, []]
  const unavailable = staffUnavailable(ctx, status, dict)

  const mine = departmentOptions(locale, departments, ctx.departmentIds)
  const scopes = DIGEST_SCOPES.filter((scope) =>
    scope === 'all'
      ? hasWorkspacePermission(ctx, 'tickets.read_all')
      : scope === 'department'
        ? hasWorkspacePermission(ctx, 'tickets.read_department') && (ctx.access.kind === 'all' || mine.length > 0)
        : true,
  ).map((scope) => ({ value: scope, label: d.scopes[scope] ?? scope }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.title}</CardTitle>
        <CardDescription>{d.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <Alert variant="info">{unavailable}</Alert>
        ) : (
          <DigestPanel
            tenant={slug}
            locale={locale}
            scopes={scopes}
            departments={mine}
            ticketBase={localizedPath(locale, `/app/${slug}/tickets`)}
            labels={{
              scope: d.scope,
              department: d.department,
              allMyDepartments: d.allMyDepartments,
              submit: d.submit,
              submitting: d.submitting,
              privacy: d.privacy,
              empty: d.empty,
              overview: d.overview,
              themes: d.themes,
              attention: d.attention,
              suggestions: d.suggestions,
              notice: d.notice,
              aiLabel: s.aiLabel,
              coveredSome: d.coveredSome,
              coveredAll: d.coveredAll,
              coveredOne: d.coveredOne,
            }}
            messages={formMessages(dict)}
          />
        )}
      </CardContent>
    </Card>
  )
}
