import Link from 'next/link'
import { AnalyticsView } from '@/components/analytics/analytics-view'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { buttonClasses } from '@/components/ui/button'
import { getAnalyticsOverview, listQualityGaps } from '@/lib/analytics/queries'
import { parsePeriod, PERIODS, type Gap } from '@/lib/analytics/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getWorkspaceContext, hasWorkspaceFeature, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** University analytics: every figure is computed by the database from stored records (ADR-028). */
export default async function AnalyticsPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/analytics'>) {
  const { tenant: slug } = await params
  const sp = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'analytics.view', feature: 'analytics_basic' })
  const t = dict.analytics
  const d = t.dashboard
  const advanced = hasWorkspaceFeature(ctx, 'analytics_advanced')
  const days = parsePeriod(sp.days, { advanced })
  const base = localizedPath(locale, `/app/${slug}`)
  const live = Boolean(ctx.tenantId) && !ctx.user.isPreview
  const data = live ? await getAnalyticsOverview(slug, days) : null
  const gaps: Gap[] = data?.can.gaps ? await listQualityGaps(slug, { days, agent: null, state: 'all', limit: 10 }) : []

  const filters = (
    <nav aria-label={t.periodLabel} className="mb-6 flex flex-wrap items-center gap-2">
      {PERIODS.filter((p) => p !== 90 || advanced).map((p) => (
        <Link
          key={p}
          href={`${base}/analytics?days=${p}`}
          aria-current={p === days ? 'page' : undefined}
          className={buttonClasses({ variant: p === days ? 'primary' : 'secondary', size: 'sm' })}
        >
          {t.periods[String(p)]}
        </Link>
      ))}
      {!advanced ? <span className="text-xs text-muted-foreground">{t.advancedOnly}</span> : null}
    </nav>
  )

  return (
    <>
      <PageHeader title={d.title} description={d.subtitle} />
      {filters}
      {data ? (
        <AnalyticsView
          locale={locale}
          t={t}
          data={data}
          gaps={gaps}
          days={days}
          base={base}
          links={{ knowledge: hasWorkspacePermission(ctx, 'knowledge.manage') && hasWorkspaceFeature(ctx, 'knowledge_base'), leads: hasWorkspacePermission(ctx, 'leads.read'), academic: hasWorkspacePermission(ctx, 'academic.manage') }}
        />
      ) : (
        <Alert variant="info">{d.preview}</Alert>
      )}
    </>
  )
}
