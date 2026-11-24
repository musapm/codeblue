import Link from 'next/link'
import { BarChart3, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { runSweepAction } from '@/lib/billing/actions'
import { getUsageReport, type UsageRow } from '@/lib/billing/queries'
import { formatMoney, parseMonth, shiftMonth } from '@/lib/billing/schemas'
import { BILLING_ROLES, formatBytes, formatCount, formatUsd, SUBSCRIPTION_STATUS_VARIANT } from '@/lib/billing/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages } from '@/lib/management/view'
import { requirePlatformAccess } from '@/lib/tenancy/context'

/** Usage per university for one month (platform billing staff): counts and costs only. */
export default async function UsagePage({ searchParams }: PageProps<'/[lang]/platform/usage'>) {
  const { month: raw } = await searchParams
  const month = parseMonth(typeof raw === 'string' ? raw : undefined)
  const { locale, dict } = await getI18n()
  const { user, role } = await requirePlatformAccess(locale)
  const t = dict.billing.usage
  const allowed = !user.isPreview && BILLING_ROLES.includes(role ?? '')
  const report = allowed ? await getUsageReport(month) : { month, tenants: [] as UsageRow[] }
  const base = localizedPath(locale, '/platform/usage')
  const monthLabel = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
  const n = (v: number) => formatCount(v, locale)
  const sum = (k: 'ai_calls' | 'ai_cost_usd' | 'voice_cost_usd' | 'conversations' | 'tickets') => report.tenants.reduce((a, r) => a + r[k], 0)
  const paid = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([c, v]) => formatMoney(v, c, locale))
      .join(' · ') || '—'
  const tenantHref = (slug: string) => localizedPath(locale, `/platform/tenants/${slug}/subscription`)
  const cols = t.columns

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />
      <div className="space-y-6">
        {user.isPreview ? <Alert variant="info">{t.previewNote}</Alert> : !allowed ? <Alert variant="warning">{dict.billing.onlyBilling}</Alert> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${base}?month=${shiftMonth(month, -1)}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })} aria-label={t.previous}>
            <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          </Link>
          <h2 className="min-w-40 text-center font-medium">{monthLabel}</h2>
          <Link href={`${base}?month=${shiftMonth(month, 1)}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })} aria-label={t.next}>
            <ChevronRight aria-hidden className="rtl:-scale-x-100" />
          </Link>
        </div>
        <Card>
          <CardContent>
            {report.tenants.length === 0 ? (
              <EmptyState icon={<BarChart3 />} title={t.empty} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[64rem] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-medium">{cols.university}</th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">{cols.plan}</th>
                      {[cols.members, cols.documents, cols.storage, cols.aiCalls, cols.aiCost, cols.voiceCost, cols.conversations, cols.tickets, cols.paid].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 text-end font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.tenants.map((r) => (
                      <tr key={r.slug}>
                        <td className="px-3 py-2.5">
                          <Link href={tenantHref(r.slug)} className="font-medium text-primary hover:underline">{r.name}</Link>
                          {r.is_demo ? <Badge variant="outline" className="ms-2">{dict.management.platform.tenants.demo}</Badge> : null}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {r.plan ?? <span className="text-muted-foreground">{t.noPlan}</span>}
                          {r.subscription_status ? <Badge variant={SUBSCRIPTION_STATUS_VARIANT[r.subscription_status] ?? 'neutral'} className="ms-2">{dict.billing.statuses[r.subscription_status] ?? r.subscription_status}</Badge> : null}
                        </td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{n(r.members)}{r.limits?.members != null ? <span className="text-muted-foreground"> / {n(r.limits.members)}</span> : null}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{n(r.documents)}{r.limits?.documents != null ? <span className="text-muted-foreground"> / {n(r.limits.documents)}</span> : null}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums whitespace-nowrap">{formatBytes(r.storage_bytes, locale)}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{n(r.ai_calls)}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums whitespace-nowrap">{formatUsd(r.ai_cost_usd, locale)}{r.limits?.ai_monthly_usd != null ? <span className="text-muted-foreground"> / {formatUsd(r.limits.ai_monthly_usd, locale)}</span> : null}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums whitespace-nowrap">{formatUsd(r.voice_cost_usd, locale)}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{n(r.conversations)}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{n(r.tickets)}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums whitespace-nowrap">{paid(r.paid)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border font-medium">
                    <tr>
                      <th scope="row" colSpan={5} className="px-3 py-2.5 text-start">{t.total}</th>
                      <td className="px-3 py-2.5 text-end tabular-nums">{n(sum('ai_calls'))}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{formatUsd(sum('ai_cost_usd'), locale)}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{formatUsd(sum('voice_cost_usd'), locale)}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{n(sum('conversations'))}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{n(sum('tickets'))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        {allowed ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.sweep}</CardTitle>
              <CardDescription>{t.sweepHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={runSweepAction} messages={formMessages(dict)} renderSuccess={(d) => t.sweepDone(d?.changed ?? 0)}>
                <SubmitButton variant="secondary" pendingLabel={dict.management.saving}>
                  <RefreshCw aria-hidden />
                  {t.sweep}
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
