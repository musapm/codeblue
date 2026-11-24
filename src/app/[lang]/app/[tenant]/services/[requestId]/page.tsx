import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CircleCheck, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { RequestTimeline } from '@/components/workflows/timeline'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { cancelRequestAction, commentAction } from '@/lib/workflows/actions'
import { getRequest } from '@/lib/workflows/queries'
import { CANCELLABLE, FINAL_STATUSES, fieldLabel, formatAnswer } from '@/lib/workflows/schemas'
import { formTitle, STATUS_VARIANT } from '@/lib/workflows/view'

/** A requester's own request: status, answers (as submitted, with their form version), updates, messages. */
export default async function ServiceRequestPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/services/[requestId]'>) {
  const { tenant: slug, requestId } = await params
  const { submitted } = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.read_own', feature: 'workflow_agent' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const found = await getRequest(ctx.tenantId, requestId)
  if (!found || found.request.requester_id !== ctx.user.id) notFound()
  const { request: r, definition, version, events } = found
  const w = dict.workflows
  const t = w.request
  const { canWrite } = writeMode(ctx, dict)
  const closed = FINAL_STATUSES.includes(r.status)

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/services`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.back}
      </Link>
      <PageHeader title={formTitle(locale, definition)} />
      {submitted === '1' ? (
        <Alert variant="success" role="status" className="mb-6">
          <span className="inline-flex items-center gap-2">
            <CircleCheck aria-hidden className="size-4" />
            {t.submitted(r.reference)}
          </span>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
              <Badge variant={STATUS_VARIANT[r.status]}>{w.statuses[r.status]}</Badge>
              <p className="text-sm text-muted-foreground">{w.statusHints[r.status]}</p>
            </CardHeader>
            <CardContent>
              <h2 className="mb-3 text-sm font-semibold">{t.history}</h2>
              <RequestTimeline events={events} locale={locale} dict={dict} />
            </CardContent>
          </Card>

          {!closed && canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{r.status === 'needs_info' ? t.reply : t.comment}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={commentAction} hidden={{ requestId: r.id }} messages={formMessages(dict)} resetOnSuccess showSuccess={false}>
                  <FormField name="body" label={t.comment}>
                    <Textarea name="body" rows={3} maxLength={4000} placeholder={t.commentPlaceholder} dir="auto" required />
                  </FormField>
                  <SubmitButton pendingLabel={t.sending}>{t.send}</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          ) : closed ? (
            <p className="text-sm text-muted-foreground">{t.closed}</p>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t.reference}</dt>
                  <dd className="font-mono text-base font-semibold" dir="ltr">
                    {r.reference}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.created}</dt>
                  <dd>{formatDate(locale, r.created_at, true)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.updated}</dt>
                  <dd>{formatDate(locale, r.last_activity_at, true)}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">{t.formVersion(version.version_no)}</p>
              {r.source === 'assistant' ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles aria-hidden className="size-3.5" />
                  {t.viaAssistant}
                </p>
              ) : null}
              {canWrite && CANCELLABLE.includes(r.status) ? (
                <ActionButton action={cancelRequestAction} hidden={{ requestId: r.id }} messages={formMessages(dict)} confirmMessage={t.confirmCancel} label={t.cancel} variant="ghost" />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.answers}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {version.fields.map((f) => {
                  const text = formatAnswer(locale, f, (r.answers as Record<string, unknown>)[f.key], { yes: w.yes, no: w.no })
                  return (
                    <div key={f.key}>
                      <dt className="text-xs text-muted-foreground" dir="auto">
                        {fieldLabel(locale, f)}
                      </dt>
                      <dd className={text ? 'whitespace-pre-line' : 'text-muted-foreground'}>
                        <span dir="auto">{text || w.form.notAnswered}</span>
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
