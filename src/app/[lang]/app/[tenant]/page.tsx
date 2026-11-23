import Link from 'next/link'
import { ArrowRight, MessageSquareText } from 'lucide-react'
import { StatTile } from '@/components/charts/figures'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber, formatShare } from '@/lib/analytics/format'
import { getOverviewTiles } from '@/lib/analytics/queries'
import { ratio } from '@/lib/analytics/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { findNavItem, WORKSPACE_NAV } from '@/lib/navigation/workspace-nav'
import { getWorkspaceContext, hasWorkspaceFeature, hasWorkspacePermission } from '@/lib/tenancy/context'

export default async function WorkspaceOverviewPage({ params }: PageProps<'/[lang]/app/[tenant]'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const { tenant } = ctx
  const t = dict.workspace.overview
  const base = localizedPath(locale, `/app/${tenant.slug}`)
  // Phase 8: the last 7 days for people who can view analytics (real data only; never in preview).
  const showFigures = Boolean(ctx.tenantId) && !ctx.user.isPreview && hasWorkspacePermission(ctx, 'analytics.view') && hasWorkspaceFeature(ctx, 'analytics_basic')
  const figures = showFigures ? await getOverviewTiles(tenant.slug) : null
  const a = dict.analytics
  const n = (x: number) => formatNumber(locale, x)
  const assistants = figures?.assistant ? [figures.assistant.student, figures.assistant.admissions].filter((s) => s !== undefined) : []
  const questions = assistants.reduce((sum, s) => sum + s.questions, 0)
  const answered = assistants.reduce((sum, s) => sum + s.answered, 0)
  const unanswered = assistants.reduce((sum, s) => sum + s.no_sources, 0)
  const waiting = figures?.quality ? figures.quality.gaps_open + figures.quality.negative_open + figures.quality.refused_open : null

  return (
    <>
      <PageHeader title={t.title(tenant.name)} description={t.intro} />

      {figures ? (
        <section aria-labelledby="overview-figures" className="mb-6 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="overview-figures" className="text-sm font-semibold">
              {a.overview.title}
            </h2>
            <Link href={`${base}/analytics?days=7`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {a.overview.open}
              <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {assistants.length ? (
              <>
                <StatTile label={a.overview.questions} value={n(questions)} />
                <StatTile label={a.overview.answered} value={formatShare(locale, ratio(answered, questions), a.dash)} detail={`${n(answered)} / ${n(questions)}`} />
                <StatTile label={a.overview.gaps} value={n(unanswered)} />
              </>
            ) : null}
            {figures.tickets ? <StatTile label={a.overview.openRequests} value={n(figures.tickets.open_now)} /> : null}
            {waiting !== null ? <StatTile label={a.overview.waiting} value={n(waiting)} href={`${base}/quality`} /> : null}
          </div>
        </section>
      ) : showFigures ? (
        <p className="mb-6 text-sm text-muted-foreground">{a.overview.unavailable}</p>
      ) : (
        <Alert variant="info" className="mb-6">
          {t.noFakeData}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t.setupTitle}</CardTitle>
            <CardDescription>{t.setupSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y divide-border rounded-lg border border-border">
              {t.steps.map((step, i) => (
                <li key={step.title}>
                  <Link href={`${base}/${step.href}`} className="group flex items-start gap-4 p-4 transition-colors hover:bg-muted/60">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{step.title}</span>
                        {findNavItem(WORKSPACE_NAV, step.href.split('/')[0] ?? '')?.status === 'available' ? (
                          <Badge variant="success">{t.available}</Badge>
                        ) : (
                          <Badge variant="outline">{dict.common.plannedPhase(step.phase)}</Badge>
                        )}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">{step.body}</span>
                    </span>
                    <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card className="h-fit overflow-hidden">
          <div className="flex items-center gap-3 bg-secondary px-5 py-4 text-secondary-foreground">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant logo from Supabase Storage (CSP img-src)
              <img src={tenant.logoUrl} alt="" className="size-10 rounded-lg bg-white object-contain p-0.5" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{tenant.monogram}</span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{tenant.assistantName}</p>
              <p className="truncate text-xs opacity-75">{tenant.name}</p>
            </div>
          </div>
          <CardContent className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              {tenant.welcome}
            </p>
            <Link href={`${base}/settings/branding`} className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'w-full' })}>
              {dict.workspace.settings.tabs.branding}
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
