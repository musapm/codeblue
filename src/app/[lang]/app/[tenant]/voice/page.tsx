import { PageHeader } from '@/components/app-shell/page-header'
import { VoiceSettingsForm } from '@/components/voice/settings-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatUsd } from '@/lib/analytics/format'
import { getI18n } from '@/lib/i18n/server'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { getServerSpeechProvider } from '@/lib/voice/provider'
import { getVoiceSettings, getVoiceUsage } from '@/lib/voice/queries'

/** Voice settings (assistant.configure): switches, provider, contract prices, limits, use, and how to choose a provider. */
export default async function VoiceSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/voice'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'assistant.configure', feature: 'voice' })
  const s = dict.voice.settings
  const { canWrite, notice } = writeMode(ctx, dict)
  const live = !!ctx.tenantId && !ctx.user.isPreview
  const [settings, usage] = live ? await Promise.all([getVoiceSettings(ctx.tenantId!), getVoiceUsage(slug)]) : [null, null]
  const num = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(n)

  return (
    <>
      <PageHeader title={s.title} description={s.subtitle} />
      <div className="space-y-6">
        {notice ? <Alert variant="info">{notice}</Alert> : null}
        <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
              <CardTitle>{s.status}</CardTitle>
              {settings ? <Badge variant={settings.enabled ? 'success' : 'neutral'}>{settings.enabled ? s.on : s.off}</Badge> : null}
            </CardHeader>
            <CardContent>
              {settings && canWrite ? (
                <VoiceSettingsForm
                  tenant={slug}
                  initial={settings}
                  serverConnected={getServerSpeechProvider() !== null}
                  messages={formMessages(dict)}
                  labels={{
                    enabled: s.enabled,
                    input: s.input,
                    inputHint: s.inputHint,
                    output: s.output,
                    provider: s.provider,
                    serverMissing: s.serverMissing,
                    prices: s.prices,
                    inputPrice: s.inputPrice,
                    outputPrice: s.outputPrice,
                    priceHint: s.priceHint,
                    budget: s.budget,
                    budgetHint: s.budgetHint,
                    dailyMinutes: s.dailyMinutes,
                    optional: dict.common.optional,
                    save: s.save,
                    saving: dict.management.saving,
                    providers: s.providers,
                    providerHints: s.providerHints,
                  }}
                />
              ) : settings ? (
                <p className="text-sm text-muted-foreground">{s.providers[settings.provider]}</p>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{s.usage.title}</CardTitle>
                <CardDescription>{s.usage.note}</CardDescription>
              </CardHeader>
              <CardContent>
                {usage ? (
                  <dl className="divide-y divide-border text-sm">
                    {[
                      { label: s.usage.inputMinutes, value: num(usage.inputMinutes) },
                      { label: s.usage.outputCharacters, value: num(usage.outputCharacters) },
                      { label: s.usage.people, value: num(usage.people) },
                      { label: s.usage.cost, value: formatUsd(locale, usage.costUsd) },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3 py-2">
                        <dt className="text-muted-foreground">{r.label}</dt>
                        <dd className="font-medium">{r.value}</dd>
                      </div>
                    ))}
                    {usage.unpriced ? <p className="pt-2 text-xs text-warning">{s.usage.unpriced(usage.unpriced)}</p> : null}
                  </dl>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{s.evaluation.title}</CardTitle>
                <CardDescription>{s.evaluation.intro}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1.5 ps-5 text-sm">
                  {s.evaluation.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
