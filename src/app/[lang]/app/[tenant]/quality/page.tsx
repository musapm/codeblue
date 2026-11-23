import Link from 'next/link'
import { QualityList } from '@/components/analytics/quality-list'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { buttonClasses } from '@/components/ui/button'
import { formatNumber } from '@/lib/analytics/format'
import { getQualitySummary, listFlagged, listQualityGaps } from '@/lib/analytics/queries'
import { AGENTS, parseChoice, parsePeriod, PERIODS, QUALITY_TABS, type Agent, type Flagged, type Gap } from '@/lib/analytics/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspaceFeature, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { cn } from '@/lib/utils'

const LIMIT = 50

/**
 * AI quality review: unanswered questions (grouped), answers rated not helpful, and declined
 * questions. One exchange at a time, never who asked; the database redacts and withholds (ADR-028).
 */
export default async function QualityPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/quality'>) {
  const { tenant: slug } = await params
  const sp = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'quality.review', feature: ['student_assistant', 'admissions_agent'] })
  const t = dict.analytics
  const qt = t.quality
  const tab = parseChoice(sp.tab, QUALITY_TABS, 'gaps')
  const state = parseChoice(sp.state, ['open', 'reviewed'] as const, 'open')
  const days = parsePeriod(sp.days, { advanced: true, fallback: 30 })
  const agent = parseChoice<Agent | 'all'>(sp.agent, [...AGENTS, 'all'], 'all')
  const base = localizedPath(locale, `/app/${slug}/quality`)
  const href = (over: Record<string, string>) => `${base}?${new URLSearchParams({ tab, state, days: String(days), agent, ...over }).toString()}`
  const { canWrite, notice } = writeMode(ctx, dict)
  const live = Boolean(ctx.tenantId) && !ctx.user.isPreview
  const filter = { days, agent: agent === 'all' ? null : agent, state, limit: LIMIT } as const

  const [summary, gaps, flagged] = live
    ? await Promise.all([
        getQualitySummary(slug, days),
        tab === 'gaps' ? listQualityGaps(slug, filter) : Promise.resolve([] as Gap[]),
        tab !== 'gaps' ? listFlagged(slug, { ...filter, kind: tab }) : Promise.resolve([] as Flagged[]),
      ])
    : [null, [] as Gap[], [] as Flagged[]]

  const n = (x: number) => formatNumber(locale, x)
  const canAddDocument = hasWorkspacePermission(ctx, 'knowledge.manage') && hasWorkspaceFeature(ctx, 'knowledge_base')
  const openCount = { gaps: summary?.gaps_open, negative: summary?.negative_open, refused: summary?.refused_open }

  return (
    <>
      <PageHeader title={qt.title} description={qt.subtitle} />
      {notice ? (
        <Alert variant="info" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <Alert variant="info" className="mb-6">
        {qt.privacy}
      </Alert>

      <div className="mb-6 space-y-3">
        <nav aria-label={qt.title} className="flex flex-wrap gap-2">
          {QUALITY_TABS.map((key) => (
            <Link key={key} href={href({ tab: key })} aria-current={key === tab ? 'page' : undefined} className={buttonClasses({ variant: key === tab ? 'primary' : 'secondary', size: 'sm' })}>
              {qt.tabs[key]}
              {openCount[key] ? (
                <span className={cn('rounded-full px-1.5 text-xs', key === tab ? 'bg-primary-foreground/20' : 'bg-muted')}>{n(openCount[key]!)}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <nav aria-label={qt.filter} className="flex flex-wrap items-center gap-2">
          {(['open', 'reviewed'] as const).map((s) => (
            <Link key={s} href={href({ state: s })} aria-current={s === state ? 'page' : undefined} className={cn(buttonClasses({ variant: 'ghost', size: 'sm' }), s === state && 'bg-muted')}>
              {qt.states[s]}
            </Link>
          ))}
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          {PERIODS.map((p) => (
            <Link key={p} href={href({ days: String(p) })} aria-current={p === days ? 'page' : undefined} className={cn(buttonClasses({ variant: 'ghost', size: 'sm' }), p === days && 'bg-muted')}>
              {t.periods[String(p)]}
            </Link>
          ))}
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          {(['all', ...AGENTS] as const).map((a) => (
            <Link key={a} href={href({ agent: a })} aria-current={a === agent ? 'page' : undefined} className={cn(buttonClasses({ variant: 'ghost', size: 'sm' }), a === agent && 'bg-muted')}>
              {a === 'all' ? qt.allAgents : t.agents[a]}
            </Link>
          ))}
        </nav>
      </div>

      <QualityList
        locale={locale}
        t={t}
        slug={slug}
        tab={tab}
        state={state}
        gaps={gaps}
        flagged={flagged}
        timeZone={ctx.tenant.timezone}
        canWrite={canWrite}
        knowledgeHref={canAddDocument ? localizedPath(locale, `/app/${slug}/knowledge`) : null}
        limit={LIMIT}
        messages={formMessages(dict)}
      />
    </>
  )
}
