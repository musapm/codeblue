import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { RequestTimeline } from '@/components/workflows/timeline'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, Textarea } from '@/components/ui/input'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { assignRequestAction, commentAction, updateStatusAction } from '@/lib/workflows/actions'
import { getRequest, listAssignees } from '@/lib/workflows/queries'
import { FINAL_STATUSES, fieldLabel, formatAnswer, NEXT_STATUSES } from '@/lib/workflows/schemas'
import { formTitle, STATUS_VARIANT } from '@/lib/workflows/view'

/** Processing one request: answers, history, next step with a message, assignment, internal notes. */
export default async function ProcessRequestPage({ params }: PageProps<'/[lang]/app/[tenant]/workflows/requests/[requestId]'>) {
  const { tenant: slug, requestId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.update', feature: 'workflow_agent' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const found = await getRequest(ctx.tenantId, requestId)
  if (!found) notFound()
  const { request: r, definition, version, events } = found
  const w = dict.workflows
  const p = w.process
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)

  const own = r.requester_id === ctx.user.id
  const inQueue =
    hasWorkspacePermission(ctx, 'tickets.read_all') ||
    (hasWorkspacePermission(ctx, 'tickets.read_department') && !!r.department_id && ctx.departmentIds.includes(r.department_id)) ||
    r.assignee_id === ctx.user.id
  const canProcess = canWrite && !own && inQueue
  const canAssign = canProcess && hasWorkspacePermission(ctx, 'tickets.assign')
  const canNote = canProcess && hasWorkspacePermission(ctx, 'tickets.notes.write')
  const closed = FINAL_STATUSES.includes(r.status)
  const next = NEXT_STATUSES[r.status]

  const [assignees, departments] = await Promise.all([canAssign ? listAssignees(slug, r.department_id) : Promise.resolve([]), listDepartments(ctx.tenantId)])
  const department = departments.find((d) => d.id === r.department_id)
  const assigneeName = !r.assignee_id ? p.nobody : r.assignee_id === ctx.user.id ? w.queue.you : (assignees.find((a) => a.user_id === r.assignee_id)?.name ?? w.queue.assigned)

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/workflows`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {p.back}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-lg font-semibold" dir="ltr">
          {r.reference}
        </h2>
        <Badge variant={STATUS_VARIANT[r.status]}>{w.statuses[r.status]}</Badge>
        <span className="text-sm font-medium" dir="auto">
          {formTitle(locale, definition)}
        </span>
        {r.source === 'assistant' ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles aria-hidden className="size-3.5" />
            {w.request.viaAssistant}
          </span>
        ) : null}
      </div>
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      {own ? (
        <Alert variant="warning" className="mb-6">
          {p.own}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{w.request.answers}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {version.fields.map((f) => {
                  const text = formatAnswer(locale, f, (r.answers as Record<string, unknown>)[f.key], { yes: w.yes, no: w.no })
                  return (
                    <div key={f.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
                      <dt className="text-sm font-medium" dir="auto">
                        {fieldLabel(locale, f)}
                      </dt>
                      <dd className={text ? 'text-sm whitespace-pre-line' : 'text-sm text-muted-foreground'}>
                        <span dir="auto">{text || w.form.notAnswered}</span>
                      </dd>
                    </div>
                  )
                })}
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">{w.request.formVersion(version.version_no)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{w.request.history}</CardTitle>
            </CardHeader>
            <CardContent>
              <RequestTimeline events={events} locale={locale} dict={dict} />
            </CardContent>
          </Card>

          {canProcess && !closed ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{p.comment}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={commentAction} hidden={{ requestId: r.id }} messages={messages} resetOnSuccess showSuccess={false}>
                  <FormField name="body" label={p.comment}>
                    <Textarea name="body" rows={3} maxLength={4000} dir="auto" required />
                  </FormField>
                  <SubmitButton pendingLabel={w.request.sending}>{p.send}</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6 text-sm">
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{p.requester}</dt>
                  <dd dir="auto">{r.requester_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{p.department}</dt>
                  <dd>{department ? (locale === 'ar' && department.nameAr) || department.name : p.generalQueue}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{p.assignee}</dt>
                  <dd>{assigneeName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{w.request.created}</dt>
                  <dd>{formatDate(locale, r.created_at, true)}</dd>
                </div>
              </dl>
              {canProcess && !closed ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {r.assignee_id !== ctx.user.id ? <ActionButton action={assignRequestAction} hidden={{ requestId: r.id, assignee: 'me' }} messages={messages} label={p.assignMe} /> : null}
                  {r.assignee_id && (r.assignee_id === ctx.user.id || canAssign) ? (
                    <ActionButton action={assignRequestAction} hidden={{ requestId: r.id, assignee: '' }} messages={messages} label={p.unassign} variant="ghost" />
                  ) : null}
                </div>
              ) : null}
              {canAssign && !closed && assignees.length ? (
                <ActionForm action={assignRequestAction} hidden={{ requestId: r.id }} messages={messages} showSuccess={false} className="mt-4">
                  <FormField name="assignee" label={p.assignTo}>
                    <Select name="assignee" defaultValue={r.assignee_id ?? ''}>
                      <option value="">{p.nobody}</option>
                      {assignees.map((a) => (
                        <option key={a.user_id} value={a.user_id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <SubmitButton variant="secondary" size="sm">
                    {p.assign}
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </CardContent>
          </Card>

          {canProcess ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{p.nextStep}</CardTitle>
              </CardHeader>
              <CardContent>
                {next.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{p.noNextStep}</p>
                ) : (
                  <ActionForm action={updateStatusAction} hidden={{ requestId: r.id }} messages={messages} resetOnSuccess showSuccess={false}>
                    <FormField name="status" label={p.newStatus}>
                      <Select name="status" defaultValue={next[0]}>
                        {next.map((s) => (
                          <option key={s} value={s}>
                            {w.statuses[s]}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField name="message" label={p.message} hint={p.messageHint} optionalLabel={dict.common.optional}>
                      <Textarea name="message" rows={3} maxLength={4000} dir="auto" />
                    </FormField>
                    <SubmitButton pendingLabel={p.updating}>{p.update}</SubmitButton>
                  </ActionForm>
                )}
              </CardContent>
            </Card>
          ) : null}

          {canNote ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{p.note}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={commentAction} hidden={{ requestId: r.id, internal: 'on' }} messages={messages} resetOnSuccess showSuccess={false}>
                  <FormField name="body" label={p.note} hint={p.noteHint}>
                    <Textarea name="body" rows={3} maxLength={4000} dir="auto" required />
                  </FormField>
                  <SubmitButton variant="secondary" pendingLabel={w.request.sending}>
                    {p.addNote}
                  </SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
