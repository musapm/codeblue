import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Pause, Play, Trash2, Undo2 } from 'lucide-react'
import { SubmitButton } from '@/components/forms/submit-button'
import { IntegrationFields } from '@/components/integrations/integration-fields'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { deleteIntegrationAction, saveIntegrationAction, setIntegrationStatusAction } from '@/lib/integrations/actions'
import { getIntegration } from '@/lib/integrations/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

const STATUS_VARIANT = { draft: 'neutral', active: 'success', paused: 'warning', error: 'danger' } as const
const LEVEL_VARIANT = { info: 'neutral', warning: 'warning', error: 'danger' } as const

export default async function IntegrationPage({ params }: PageProps<'/[lang]/app/[tenant]/integrations/[integrationId]'>) {
  const { tenant: slug, integrationId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'integrations.manage', feature: 'integrations' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const found = await getIntegration(ctx.tenantId, integrationId)
  if (!found) notFound()
  const { integration: i, logs } = found
  const t = dict.integrations
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)
  const hidden = { tenant: slug, locale, integrationId: i.id }

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/integrations`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.back}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold" dir="auto">
          {i.name}
        </h1>
        <span className="text-sm text-muted-foreground">{t.kinds[i.kind]}</span>
        <Badge variant={STATUS_VARIANT[i.status as keyof typeof STATUS_VARIANT] ?? 'neutral'}>{t.statuses[i.status] ?? i.status}</Badge>
        {i.last_ok_at ? <span className="text-xs text-muted-foreground">{t.lastOk(formatDate(locale, i.last_ok_at, true))}</span> : null}
        {i.last_error_at ? <span className="text-xs text-danger">{t.lastError(formatDate(locale, i.last_error_at, true))}</span> : null}
      </div>
      <div className="space-y-6">
        {notice ? <Alert variant="info">{notice}</Alert> : null}
        <Alert variant="info">{t.notBuilt}</Alert>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {i.status !== 'active' ? (
              i.secret_ref ? (
                <ActionButton action={setIntegrationStatusAction} hidden={{ integrationId: i.id, status: 'active' }} messages={messages} label={t.activate} variant="primary" size="md" icon={<Play aria-hidden />} />
              ) : (
                <p className="text-sm text-muted-foreground">{t.activateNeedsSecret}</p>
              )
            ) : (
              <ActionButton action={setIntegrationStatusAction} hidden={{ integrationId: i.id, status: 'paused' }} messages={messages} label={t.pause} size="md" icon={<Pause aria-hidden />} />
            )}
            {i.status !== 'draft' ? <ActionButton action={setIntegrationStatusAction} hidden={{ integrationId: i.id, status: 'draft' }} messages={messages} label={t.draft} variant="ghost" size="md" icon={<Undo2 aria-hidden />} /> : null}
            <ActionButton action={deleteIntegrationAction} hidden={hidden} messages={messages} confirmMessage={t.confirmDelete} label={t.delete} variant="ghost" size="md" icon={<Trash2 aria-hidden />} />
          </div>
        ) : null}
        <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <Card>
            <CardContent className="pt-6">
              {canWrite ? (
                <ActionForm action={saveIntegrationAction} hidden={hidden} messages={messages}>
                  <IntegrationFields dict={dict} integration={i} />
                  <SubmitButton pendingLabel={dict.management.saving}>{t.save}</SubmitButton>
                </ActionForm>
              ) : null}
            </CardContent>
          </Card>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t.log}</CardTitle>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.logEmpty}</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {logs.map((l) => (
                    <li key={l.id} className="space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge variant={LEVEL_VARIANT[l.level as keyof typeof LEVEL_VARIANT] ?? 'neutral'}>{l.level}</Badge>
                        <code className="text-xs" dir="ltr">
                          {l.event}
                        </code>
                        <span className="text-xs text-muted-foreground">{formatDate(locale, l.created_at, true)}</span>
                      </p>
                      {l.message ? (
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {l.message}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
