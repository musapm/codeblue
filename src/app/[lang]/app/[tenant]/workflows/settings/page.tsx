import { Meter } from '@/components/charts/figures'
import { WorkflowSettingsForm } from '@/components/workflows/settings-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAiConfig } from '@/lib/ai/config'
import { formatUsd } from '@/lib/analytics/format'
import { getI18n } from '@/lib/i18n/server'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { getWorkflowSettings, getWorkflowUsage } from '@/lib/workflows/queries'

/** The AI form suggestion: switch, budget, daily limit, and this month's figures (assistant.configure). */
export default async function WorkflowSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/workflows/settings'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'assistant.configure', feature: 'workflow_agent' })
  const s = dict.workflows.settings
  const { canWrite, notice } = writeMode(ctx, dict)
  const live = !!ctx.tenantId && !ctx.user.isPreview
  const [settings, usage] = live ? await Promise.all([getWorkflowSettings(ctx.tenantId!), getWorkflowUsage(slug)]) : [null, null]
  const usd = (n: number) => formatUsd(locale, n)
  const num = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(n)
  const spent = usage?.costUsd ?? 0
  const budget = settings?.monthlyBudgetUsd ?? 0
  const level = budget > 0 && spent >= budget ? 'over' : budget > 0 && spent >= budget * 0.8 ? 'warning' : 'normal'

  return (
    <div className="space-y-6">
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {!getAiConfig().configured ? <Alert variant="warning">{s.notConfigured}</Alert> : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
            <CardTitle>{s.title}</CardTitle>
            {settings ? <Badge variant={settings.aiEnabled ? 'success' : 'neutral'}>{settings.aiEnabled ? s.on : s.off}</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <CardDescription>{s.subtitle}</CardDescription>
            {settings && canWrite ? (
              <WorkflowSettingsForm
                tenant={slug}
                initial={settings}
                messages={formMessages(dict)}
                labels={{ enabled: s.enabled, budget: s.budget, budgetHint: s.budgetHint, dailyLimit: s.dailyLimit, save: s.save, saving: dict.management.saving }}
              />
            ) : settings ? (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="font-medium">{s.budget}</dt>
                  <dd className="text-muted-foreground">{usd(settings.monthlyBudgetUsd)}</dd>
                </div>
                <div>
                  <dt className="font-medium">{s.dailyLimit}</dt>
                  <dd className="text-muted-foreground">{num(settings.dailyLimit)}</dd>
                </div>
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
            {usage && settings ? (
              <>
                {budget > 0 ? (
                  <Meter
                    label={s.usage.cost}
                    value={spent}
                    max={budget}
                    level={level}
                    valueText={`${usd(spent)} ${s.usage.ofBudget(usd(budget))}`}
                    statusText={level === 'over' ? dict.analytics.dashboard.ai.over : level === 'warning' ? dict.analytics.dashboard.ai.warning : undefined}
                  />
                ) : (
                  <p className="text-sm">
                    <span className="font-medium">{s.usage.cost}: </span>
                    {usd(spent)}
                  </p>
                )}
                <dl className="divide-y divide-border text-sm">
                  {[
                    { label: s.usage.requests, value: usage.requests },
                    { label: s.usage.fromAssistant, value: usage.fromAssistant },
                    { label: s.usage.suggestions, value: usage.suggestions },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="font-medium">{num(r.value)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
