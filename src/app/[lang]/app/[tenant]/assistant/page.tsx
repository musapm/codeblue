import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { AssistantSettingsForm } from '@/components/assistant/settings-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAiConfig } from '@/lib/ai/config'
import { getAssistantSettings, getUsageSummary, type UsageSummary } from '@/lib/assistant/queries'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Assistant administration: on/off switch, extra guidance, monthly budget, this month's usage. */
export default async function AssistantSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/assistant'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'assistant.configure', feature: 'student_assistant' })
  const s = dict.management.assistant.settings
  const { canWrite, notice } = writeMode(ctx, dict)
  const ai = getAiConfig()

  const [settings, usage] = ctx.tenantId ? await Promise.all([getAssistantSettings(ctx.tenantId), getUsageSummary(slug)]) : [null, null]
  const money = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 }).format(n)
  const num = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(n)
  const canUse = hasWorkspacePermission(ctx, 'assistant.use')

  const rows = (u: UsageSummary) => [
    { label: s.usage.questions, value: num(u.questions) },
    { label: s.usage.answered, value: num(u.answered) },
    { label: s.usage.noSources, value: num(u.noSources) },
    { label: s.usage.refused, value: num(u.refused) },
    { label: s.usage.errors, value: num(u.errors) },
    { label: s.usage.helpful, value: num(u.helpful) },
    { label: s.usage.notHelpful, value: num(u.notHelpful) },
    { label: s.usage.tokens, value: `${num(u.inputTokens)} / ${num(u.outputTokens)}` },
  ]

  return (
    <>
      <PageHeader
        title={s.title}
        description={s.subtitle}
        actions={
          canUse ? (
            <Link href={localizedPath(locale, `/app/${slug}/ask`)} className={buttonClasses({ variant: 'secondary' })}>
              <MessageSquare aria-hidden />
              {s.openChat}
            </Link>
          ) : undefined
        }
      />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      {!ai.configured ? (
        <Alert variant="warning" className="mb-6">
          {s.notConfigured}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
            <CardTitle>{s.status}</CardTitle>
            {settings ? <Badge variant={settings.enabled ? 'success' : 'neutral'}>{settings.enabled ? s.on : s.off}</Badge> : null}
            <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
              {s.model(ai.model)}
            </span>
          </CardHeader>
          <CardContent>
            {settings && canWrite ? (
              <AssistantSettingsForm
                tenant={slug}
                initial={settings}
                messages={formMessages(dict)}
                labels={{
                  enabled: s.enabled,
                  instructions: s.instructions,
                  instructionsHint: s.instructionsHint,
                  budget: s.budget,
                  budgetHint: s.budgetHint,
                  optional: dict.common.optional,
                  save: s.save,
                  saving: dict.management.saving,
                }}
              />
            ) : settings ? (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="font-medium">{s.budget}</dt>
                  <dd className="text-muted-foreground">{money(settings.monthlyBudgetUsd)}</dd>
                </div>
                {settings.instructions ? (
                  <div>
                    <dt className="font-medium">{s.instructions}</dt>
                    <dd className="whitespace-pre-line text-muted-foreground" dir="auto">
                      {settings.instructions}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{s.usage.title}</CardTitle>
            <CardDescription>{s.usage.estimateNote}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {usage ? (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{s.usage.cost}</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {money(usage.costUsd)}{' '}
                    <span className="text-sm font-normal text-muted-foreground">{s.usage.ofBudget(money(settings?.monthlyBudgetUsd ?? 0))}</span>
                  </p>
                </div>
                {usage.questions === 0 ? (
                  <p className="text-sm text-muted-foreground">{s.usage.empty}</p>
                ) : (
                  <dl className="divide-y divide-border text-sm">
                    {rows(usage).map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3 py-2">
                        <dt className="text-muted-foreground">{r.label}</dt>
                        <dd className="font-medium tabular-nums">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{s.usage.empty}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
