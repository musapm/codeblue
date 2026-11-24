import Link from 'next/link'
import { ArrowRight, BookOpen, SearchX } from 'lucide-react'
import { BarList } from '@/components/charts/bar-list'
import { ColumnChart } from '@/components/charts/charts'
import { Meter, StatTile } from '@/components/charts/figures'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { formatDay, formatInstant, formatMinutes, formatNumber, formatSeconds, formatShare, formatUsd } from '@/lib/analytics/format'
import { budgetLevel, ratio, type AssistantStats, type Gap, type Overview, type Period } from '@/lib/analytics/schemas'
import type { Locale } from '@/lib/i18n/config'
import type { AnalyticsDictionary } from '@/lib/i18n/dictionaries/analytics.en'

/**
 * The analytics dashboard body (server component). Plain data in: the page fetches it from the
 * database, so this renders exactly what was computed and nothing else.
 */
export function AnalyticsView({
  locale,
  t,
  data,
  gaps,
  days,
  base,
  links,
}: {
  locale: Locale
  t: AnalyticsDictionary
  data: Overview
  gaps: Gap[]
  days: Period
  /** Workspace root, e.g. /en/app/northbridge */
  base: string
  links: { knowledge: boolean; leads: boolean; academic?: boolean; workflows?: boolean }
}) {
  const d = t.dashboard
  const n = (x: number) => formatNumber(locale, x)
  const share = (part: number, whole: number) => formatShare(locale, ratio(part, whole), t.dash)
  const usd = (x: number) => formatUsd(locale, x)
  const bucketLabel = (ymd: string) => (data.period.bucket === 'week' ? `${t.week} ${formatDay(locale, ymd)}` : formatDay(locale, ymd))
  const when = (iso: string) => formatInstant(locale, iso, data.period.timezone)

  const agents = (['student', 'admissions', 'staff'] as const).filter((a) => data.assistant?.[a])
  const all = agents.reduce(
    (acc, a) => {
      const s = data.assistant![a]!
      return { questions: acc.questions + s.questions, answered: acc.answered + s.answered, gaps: acc.gaps + s.no_sources, helpful: acc.helpful + s.helpful, rated: acc.rated + s.helpful + s.not_helpful }
    },
    { questions: 0, answered: 0, gaps: 0, helpful: 0, rated: 0 },
  )

  const assistantCard = (agent: (typeof agents)[number], s: AssistantStats) => {
    const recorded = s.answered + s.no_sources + s.refused + s.errors
    const outcomes = [
      { key: 'answered', label: d.assistant.answered, value: s.answered },
      { key: 'no_sources', label: d.assistant.unanswered, value: s.no_sources },
      { key: 'refused', label: d.assistant.declined, value: s.refused },
      { key: 'errors', label: d.assistant.errors, value: s.errors },
      { key: 'none', label: d.assistant.noAnswer, value: Math.max(0, s.questions - recorded) },
    ]
    const chartTitle = data.period.bucket === 'week' ? d.assistant.perWeek : d.assistant.perDay
    return (
      <Card key={agent}>
        <CardHeader>
          <CardTitle className="text-base">{t.agents[agent]}</CardTitle>
          <CardDescription>
            {[
              `${d.assistant.questions}: ${n(s.questions)}`,
              `${d.assistant.people}: ${n(s.people)}`,
              `${d.assistant.latency}: ${formatSeconds(locale, s.median_latency_ms, t.dash)}`,
            ].join(' · ')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {s.questions === 0 ? (
            <p className="text-sm text-muted-foreground">{d.assistant.none}</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">{chartTitle}</h3>
                <ColumnChart
                  ariaLabel={`${t.agents[agent]}: ${chartTitle}`}
                  data={s.series.map((b) => ({ key: b.start, label: bucketLabel(b.start), value: b.questions, tooltip: `${bucketLabel(b.start)}: ${n(b.questions)}` }))}
                  tableLabels={{ show: t.showTable, period: data.period.bucket === 'week' ? t.week : t.day, value: d.assistant.questions }}
                  extraColumns={[
                    { label: d.assistant.answered, values: s.series.map((b) => b.answered) },
                    { label: d.assistant.unanswered, values: s.series.map((b) => b.gaps) },
                  ]}
                />
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-medium">{d.assistant.outcomes}</h3>
                <BarList rows={outcomes} emptyLabel={d.assistant.none} format={n} />
                <p className="text-sm text-muted-foreground">
                  {d.assistant.helpful}: {s.helpful + s.not_helpful > 0 ? `${share(s.helpful, s.helpful + s.not_helpful)} ${d.assistant.ofRatings(n(s.helpful + s.not_helpful))}` : d.assistant.noRatings}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  const tk = data.tickets
  const tkChartTitle = data.period.bucket === 'week' ? d.tickets.perWeek : d.tickets.perDay
  const ai = data.ai
  // Request drafts and summaries are paid from the student assistant's budget (ADR-027).
  const budgets: { key: string; label: string; spent: number; budget: number | null; hint?: string }[] = ai
    ? [
        {
          key: 'student',
          label: d.ai.features.student_assistant ?? '',
          spent: ai.month.student_assistant + ai.month.ticketing,
          budget: ai.budgets.student_assistant,
          hint: ai.month.ticketing > 0 ? d.ai.sharedBudget : undefined,
        },
        { key: 'admissions', label: d.ai.features.admissions_agent ?? '', spent: ai.month.admissions_agent, budget: ai.budgets.admissions_agent },
        { key: 'academic', label: d.ai.features.academic_agent ?? '', spent: ai.month.academic_agent ?? 0, budget: ai.budgets.academic_agent ?? null },
        { key: 'staff', label: d.ai.features.staff_assistant ?? '', spent: ai.month.staff_assistant ?? 0, budget: ai.budgets.staff_assistant ?? null },
        { key: 'workflows', label: d.ai.features.workflow_agent ?? '', spent: ai.month.workflow_agent ?? 0, budget: ai.budgets.workflow_agent ?? null },
        { key: 'campus', label: d.ai.features.campus_assistant ?? '', spent: ai.month.campus_assistant ?? 0, budget: ai.budgets.campus_assistant ?? null },
      ]
    : []
  const q = data.quality

  return (
    <>
      <div className="space-y-6">
        {/* Headline figures */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {agents.length ? (
            <>
              <StatTile label={d.assistant.questions} value={n(all.questions)} />
              <StatTile label={d.assistant.answered} value={share(all.answered, all.questions)} detail={`${n(all.answered)} / ${n(all.questions)}`} />
              <StatTile label={d.assistant.unanswered} value={n(all.gaps)} />
              <StatTile label={d.assistant.helpful} value={share(all.helpful, all.rated)} detail={all.rated ? d.assistant.ofRatings(n(all.rated)) : d.assistant.noRatings} />
            </>
          ) : null}
          <StatTile label={d.members} value={n(data.members.active)} />
        </div>

        {agents.map((a) => assistantCard(a, data.assistant![a]!))}

        {data.can.gaps ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{d.gaps.title}</CardTitle>
              <CardDescription>{d.gaps.subtitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {gaps.length === 0 ? (
                <EmptyState icon={<SearchX />} title={d.gaps.empty} />
              ) : (
                <ol className="divide-y divide-border rounded-lg border border-border">
                  {gaps.map((g, i) => (
                    <li key={i} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                      <span className="w-10 shrink-0 text-sm font-semibold">{d.gaps.asked(n(g.count))}</span>
                      <span className="min-w-0 flex-1 text-sm" dir="auto">
                        {g.question}
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {g.agents.map((a) => (
                          <Badge key={a} variant="outline">
                            {t.agents[a]}
                          </Badge>
                        ))}
                        {when(g.last_at)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex flex-wrap gap-2">
                {data.can.review ? (
                  <Link href={`${base}/quality?tab=gaps&days=${days}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                    {d.gaps.review}
                    <ArrowRight aria-hidden className="rtl:-scale-x-100" />
                  </Link>
                ) : null}
                {links.knowledge ? (
                  <Link href={`${base}/knowledge`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                    <BookOpen aria-hidden />
                    {d.gaps.addDocument}
                  </Link>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tk ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{d.tickets.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <StatTile label={d.tickets.created} value={n(tk.created)} detail={d.tickets.fromAssistant(n(tk.from_assistant))} />
                <StatTile label={d.tickets.resolved} value={n(tk.resolved)} />
                <StatTile label={d.tickets.openNow} value={n(tk.open_now)} detail={d.tickets.unassigned(n(tk.unassigned_now))} />
                <StatTile
                  label={d.tickets.firstResponse}
                  value={formatMinutes(locale, tk.median_first_response_minutes, t.dash)}
                  detail={d.tickets.awaiting(n(tk.awaiting_first_response))}
                />
                <StatTile label={d.tickets.resolution} value={formatMinutes(locale, tk.median_resolution_hours === null ? null : tk.median_resolution_hours * 60, t.dash)} />
              </div>
              {tk.created === 0 && tk.open_now === 0 ? (
                <p className="text-sm text-muted-foreground">{d.tickets.none}</p>
              ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                  <div>
                    <h3 className="mb-2 text-sm font-medium">{tkChartTitle}</h3>
                    <ColumnChart
                      ariaLabel={tkChartTitle}
                      data={tk.series.map((b) => ({ key: b.start, label: bucketLabel(b.start), value: b.created, tooltip: `${bucketLabel(b.start)}: ${n(b.created)}` }))}
                      tableLabels={{ show: t.showTable, period: data.period.bucket === 'week' ? t.week : t.day, value: d.tickets.created }}
                      extraColumns={[{ label: d.tickets.resolvedColumn, values: tk.series.map((b) => b.resolved) }]}
                    />
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium">{d.tickets.byDepartment}</h3>
                    <BarList
                      format={n}
                      emptyLabel={d.tickets.none}
                      rows={tk.by_department.map((x, i) => ({ key: x.id ?? `general-${i}`, label: x.id ? (locale === 'ar' && x.name_ar) || x.name || t.dash : d.tickets.generalQueue, value: x.open }))}
                    />
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium">{d.tickets.byCategory}</h3>
                    <BarList
                      format={n}
                      emptyLabel={d.tickets.none}
                      rows={tk.by_category.map((x, i) => ({ key: x.id ?? `none-${i}`, label: x.id ? (locale === 'ar' && x.name_ar) || x.name || t.dash : d.tickets.noCategory, value: x.created }))}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          {data.knowledge ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{d.knowledge.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label={d.knowledge.published} value={n(data.knowledge.published)} />
                  <StatTile label={d.knowledge.expired} value={n(data.knowledge.expired)} />
                  <StatTile label={d.knowledge.unpublished} value={n(data.knowledge.unpublished)} />
                </div>
                {data.knowledge.expired ? <p className="text-xs text-muted-foreground">{d.knowledge.expiredHint}</p> : null}
                <div>
                  <h3 className="text-sm font-medium">{d.knowledge.topCited}</h3>
                  <p className="mb-3 text-xs text-muted-foreground">{d.knowledge.topCitedHint}</p>
                  <BarList
                    format={n}
                    emptyLabel={d.knowledge.none}
                    rows={data.knowledge.top_cited.map((x) => ({ key: x.id, label: (locale === 'ar' && x.title_ar) || x.title, value: x.answers }))}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {data.workflows ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{d.workflows.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label={d.workflows.submitted} value={n(data.workflows.submitted)} detail={d.workflows.fromAssistant(n(data.workflows.from_assistant))} />
                  <StatTile label={d.workflows.completed} value={n(data.workflows.completed)} detail={d.workflows.rejected(n(data.workflows.rejected))} />
                  <StatTile label={d.workflows.openNow} value={n(data.workflows.open_now)} detail={d.workflows.needsInfo(n(data.workflows.open_by_status.needs_info))} />
                  <StatTile
                    label={d.workflows.median}
                    value={formatMinutes(locale, data.workflows.median_completion_hours === null ? null : data.workflows.median_completion_hours * 60, t.dash)}
                  />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">{d.workflows.byForm}</h3>
                  <BarList
                    format={n}
                    emptyLabel={t.dash}
                    rows={data.workflows.by_form.map((f) => ({ key: f.id, label: (locale === 'ar' && f.title_ar) || f.title, value: f.submitted }))}
                  />
                </div>
                {links.workflows ? (
                  <Link href={`${base}/workflows`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                    {d.workflows.open}
                    <ArrowRight aria-hidden className="rtl:-scale-x-100" />
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {data.academic ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{d.academic.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label={d.academic.courses} value={n(data.academic.courses.active)} detail={d.academic.toolsOn(n(data.academic.courses.ai_enabled))} />
                  <StatTile label={d.academic.students} value={n(data.academic.students)} />
                  <StatTile label={d.academic.attempts} value={n(data.academic.attempts)} />
                  <StatTile label={d.academic.people} value={n(data.academic.people)} />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">{d.academic.generated}</h3>
                  <BarList
                    format={n}
                    emptyLabel={t.dash}
                    rows={(['quiz', 'flashcards', 'summary', 'study_plan'] as const)
                      .map((k) => ({ key: k, label: d.academic.kinds[k] ?? k, value: data.academic!.generated[k] }))
                      .sort((x, y) => y.value - x.value)}
                  />
                </div>
                {links.academic ? (
                  <Link href={`${base}/academic`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                    {d.academic.open}
                    <ArrowRight aria-hidden className="rtl:-scale-x-100" />
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {data.admissions ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{d.admissions.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <StatTile label={d.admissions.leads} value={n(data.admissions.leads)} />
                <BarList
                  format={n}
                  emptyLabel={t.dash}
                  rows={(['form', 'assistant', 'manual'] as const).map((s) => ({ key: s, label: d.admissions.sources[s] ?? s, value: data.admissions!.by_source[s] }))}
                />
                {links.leads ? (
                  <Link href={`${base}/admissions/analytics`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                    {d.admissions.open}
                    <ArrowRight aria-hidden className="rtl:-scale-x-100" />
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {ai ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{d.ai.title}</CardTitle>
                <CardDescription>{d.ai.subtitle}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <h3 className="text-sm font-medium">{d.ai.month}</h3>
                {budgets
                  .filter((m) => m.budget !== null || m.spent > 0)
                  .map((m) => {
                    const level = budgetLevel(m.spent, m.budget)
                    return (
                      <div key={m.key} className="space-y-1">
                        {level === 'none' ? (
                          <p className="flex justify-between gap-2 text-sm">
                            <span className="font-medium">{m.label}</span>
                            <span className="text-muted-foreground">
                              {usd(m.spent)} · {d.ai.noBudget}
                            </span>
                          </p>
                        ) : (
                          <Meter
                            label={m.label}
                            value={m.spent}
                            max={m.budget!}
                            level={level}
                            valueText={d.ai.ofBudget(usd(m.spent), usd(m.budget!))}
                            statusText={level === 'over' ? d.ai.over : d.ai.warning}
                          />
                        )}
                        {m.hint ? <p className="text-xs text-muted-foreground">{m.hint}</p> : null}
                      </div>
                    )
                  })}
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  {(['student_assistant', 'admissions_agent', 'ticketing', 'academic_agent', 'staff_assistant', 'workflow_agent', 'campus_assistant'] as const).map((f) => (
                    <div key={f}>
                      <dt className="text-xs text-muted-foreground">{d.ai.features[f]}</dt>
                      <dd className="font-semibold">{usd(ai.month[f] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium">{d.ai.period}</h3>
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">{d.ai.calls}</dt>
                      <dd className="font-semibold">{n(ai.period.calls)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{d.ai.cost}</dt>
                      <dd className="font-semibold">{usd(ai.period.cost_usd)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{d.ai.tokens}</dt>
                      <dd className="font-semibold" dir="ltr">
                        {n(ai.period.input_tokens)} / {n(ai.period.output_tokens)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {q ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{d.quality.title}</CardTitle>
                <CardDescription>{d.quality.waiting}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label={d.quality.gaps} value={n(q.gaps_open)} href={`${base}/quality?tab=gaps&days=${days}`} />
                  <StatTile label={d.quality.negative} value={n(q.negative_open)} href={`${base}/quality?tab=negative&days=${days}`} />
                  <StatTile label={d.quality.refused} value={n(q.refused_open)} href={`${base}/quality?tab=refused&days=${days}`} />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    {d.quality.outcomes} · {d.quality.reviewed}: {n(q.reviewed)}
                  </h3>
                  <BarList
                    format={n}
                    emptyLabel={t.dash}
                    rows={(['knowledge_added', 'knowledge_needed', 'assistant_error', 'correct', 'out_of_scope'] as const)
                      .map((o) => ({ key: o, label: t.quality.outcomes[o] ?? o, value: q.outcomes[o] ?? 0 }))
                      .sort((x, y) => y.value - x.value)}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">{d.generated(when(data.generated_at), data.period.timezone)}</p>
      </div>
    </>
  )
}
