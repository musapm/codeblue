import Link from 'next/link'
import { Plug } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SubmitButton } from '@/components/forms/submit-button'
import { IntegrationFields } from '@/components/integrations/integration-fields'
import { ActionForm } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { saveIntegrationAction } from '@/lib/integrations/actions'
import { listIntegrations } from '@/lib/integrations/queries'
import { INTEGRATION_KINDS } from '@/lib/integrations/schemas'
import { formMessages, writeMode } from '@/lib/management/view'
import { getEmailSender } from '@/lib/notifications/email'
import { getOutboxSummary } from '@/lib/notifications/queries'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

const STATUS_VARIANT = { draft: 'neutral', active: 'success', paused: 'warning', error: 'danger' } as const

/** Integrations (integrations.manage): list, create, and the email outbox in numbers. */
export default async function IntegrationsPage({ params }: PageProps<'/[lang]/app/[tenant]/integrations'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'integrations.manage', feature: 'integrations' })
  const t = dict.integrations
  const { canWrite, notice } = writeMode(ctx, dict)
  const live = !!ctx.tenantId && !ctx.user.isPreview
  const [items, outbox] = live ? await Promise.all([listIntegrations(ctx.tenantId!), getOutboxSummary(slug)]) : [[], null]
  const base = localizedPath(locale, `/app/${slug}/integrations`)
  const num = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(n)

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />
      <div className="space-y-6">
        {notice ? <Alert variant="info">{notice}</Alert> : null}
        <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
          <Card>
            <CardContent className="pt-6">
              {items.length === 0 ? (
                <EmptyState icon={<Plug />} title={t.empty} />
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Link href={`${base}/${i.id}`} className="font-medium text-primary hover:underline" dir="auto">
                        {i.name}
                      </Link>
                      <span className="text-sm text-muted-foreground">{t.kinds[i.kind]}</span>
                      <Badge variant={STATUS_VARIANT[i.status as keyof typeof STATUS_VARIANT] ?? 'neutral'} className="ms-auto">
                        {t.statuses[i.status] ?? i.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t.outbox.title}</CardTitle>
              <CardDescription>{t.outbox.subtitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {getEmailSender() === null ? <p className="text-xs text-warning">{t.outbox.notConnected}</p> : null}
              {outbox ? (
                <dl className="divide-y divide-border">
                  {[
                    { label: t.outbox.queued, value: outbox.queued },
                    { label: t.outbox.sent, value: outbox.sent },
                    { label: t.outbox.failed, value: outbox.failed },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between gap-3 py-2">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="font-medium">{num(r.value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.catalog}</CardTitle>
            <CardDescription>{t.notBuilt}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {INTEGRATION_KINDS.map((k) => (
                <div key={k} className="rounded-lg border border-border p-3">
                  <dt className="font-medium">{t.kinds[k]}</dt>
                  <dd className="text-muted-foreground">{t.kindHints[k]}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.create}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveIntegrationAction} hidden={{ tenant: slug, locale }} messages={formMessages(dict)} showSuccess={false}>
                <IntegrationFields dict={dict} />
                <SubmitButton pendingLabel={dict.management.saving}>{t.createSubmit}</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
