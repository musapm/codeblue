import { BarList } from '@/components/charts/bar-list'
import { ColumnChart } from '@/components/charts/charts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdmissionsAnalytics } from '@/lib/admissions/queries'
import { LEAD_STAGES } from '@/lib/admissions/schemas'
import { getI18n } from '@/lib/i18n/server'
import { formatDate } from '@/lib/management/view'
import { getWorkspaceContext } from '@/lib/tenancy/context'

/** Admissions figures computed from stored inquiries and assistant turns only. */
export default async function AdmissionsAnalyticsPage({ params }: PageProps<'/[lang]/app/[tenant]/admissions/analytics'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const a = dict.admissions
  const t = a.analytics
  const data = ctx.tenantId ? await getAdmissionsAnalytics(slug) : null
  const num = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(n)
  const usd = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 }).format(n)

  if (!data || data.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.heading}</CardTitle>
          <CardDescription>{t.empty}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const tiles = [
    { label: t.total, value: data.total },
    { label: t.last30, value: data.last_30_days },
    { label: t.open, value: data.open },
    { label: t.unassignedNew, value: data.unassigned_new },
  ]
  const weekly = data.weekly.map((w) => {
    const label = formatDate(locale, w.week_start)
    return { key: w.week_start, label, value: w.count, tooltip: `${t.weekOf(label)}: ${num(w.count)}` }
  })

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{num(tile.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.weekly}</CardTitle>
        </CardHeader>
        <CardContent>
          <ColumnChart data={weekly} ariaLabel={t.weekly} tableLabels={{ show: t.showTable, period: t.week, value: t.inquiries }} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.byStage}</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList emptyLabel={t.empty} rows={LEAD_STAGES.map((s) => ({ key: s, label: a.stages[s] ?? s, value: data.by_stage[s] ?? 0 }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.bySource}</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList emptyLabel={t.empty} rows={(['form', 'assistant', 'manual'] as const).map((s) => ({ key: s, label: a.sources[s] ?? s, value: data.by_source[s] ?? 0 }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.byProgram}</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              emptyLabel={t.empty}
              rows={data.by_program.map((p, i) => ({ key: p.program_id ?? `none-${i}`, label: (locale === 'ar' && p.name_ar) || p.name || t.noProgram, value: p.count }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.assistant}</CardTitle>
            <CardDescription>{t.estimateNote}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {[
                { label: t.questions, value: num(data.assistant.questions) },
                { label: t.answered, value: num(data.assistant.answered) },
                { label: t.noSources, value: num(data.assistant.no_sources) },
                { label: t.visitors, value: num(data.assistant.visitors) },
                { label: t.cost, value: usd(data.assistant.cost_usd) },
              ].map((r) => (
                <div key={r.label}>
                  <dt className="text-xs text-muted-foreground">{r.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{r.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
