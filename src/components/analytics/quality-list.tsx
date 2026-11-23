import Link from 'next/link'
import { BookOpen, EyeOff, FileText, RotateCcw, SearchX } from 'lucide-react'
import { ReviewForm } from '@/components/analytics/review-form'
import { ActionButton, type FormMessages } from '@/components/management/action-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { reopenQualityReview } from '@/lib/analytics/actions'
import { formatInstant } from '@/lib/analytics/format'
import { OUTCOMES, type Flagged, type Gap, type QualityTab, type Review } from '@/lib/analytics/schemas'
import type { Locale } from '@/lib/i18n/config'
import type { AnalyticsDictionary } from '@/lib/i18n/dictionaries/analytics.en'

/** The review queue of the AI quality page (server component; plain data in). */
export function QualityList({
  locale,
  t,
  slug,
  tab,
  state,
  gaps,
  flagged,
  timeZone,
  canWrite,
  knowledgeHref,
  limit,
  messages,
}: {
  locale: Locale
  t: AnalyticsDictionary
  slug: string
  tab: QualityTab
  state: 'open' | 'reviewed'
  gaps: Gap[]
  flagged: Flagged[]
  timeZone: string
  canWrite: boolean
  /** Link to add documents, for people who manage the knowledge base. */
  knowledgeHref: string | null
  limit: number
  messages: FormMessages
}) {
  const qt = t.quality
  const when = (iso: string) => formatInstant(locale, iso, timeZone)
  const outcomes = OUTCOMES.map((o) => ({ value: o, label: qt.outcomes[o] ?? o }))
  const formLabels = { outcome: qt.outcome, note: qt.note, optional: qt.optional, saving: qt.saving }
  const items = tab === 'gaps' ? gaps.length : flagged.length

  const reviewBlock = (ids: string[], review: Review | null, openIds: string[]) => {
    if (!canWrite) return review ? <p className="text-xs text-muted-foreground">{qt.reviewedBy(review.reviewer, when(review.at))}</p> : null
    if (!review || openIds.length) {
      return (
        <ReviewForm
          tenant={slug}
          messageIds={openIds.length ? openIds : ids}
          outcomes={outcomes}
          labels={{ ...formLabels, submit: qt.saveGroup(openIds.length || ids.length) }}
          messages={messages}
        />
      )
    }
    return (
      <div className="space-y-3 rounded-lg bg-muted/40 p-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="success">{qt.outcomes[review.outcome] ?? review.outcome}</Badge>
          <span className="text-xs text-muted-foreground">{qt.reviewedBy(review.reviewer, when(review.at))}</span>
        </p>
        {review.note ? (
          <p className="text-sm whitespace-pre-line" dir="auto">
            {review.note}
          </p>
        ) : null}
        <details>
          <summary className="cursor-pointer text-xs font-medium text-primary">{qt.change}</summary>
          <div className="mt-3">
            <ReviewForm tenant={slug} messageIds={ids} outcomes={outcomes} initial={review} labels={{ ...formLabels, submit: qt.save }} messages={messages} />
          </div>
        </details>
        <ActionButton action={reopenQualityReview} hidden={{ tenant: slug, messageIds: ids.join(',') }} messages={messages} label={qt.reopen} icon={<RotateCcw aria-hidden />} variant="ghost" />
      </div>
    )
  }

  return (
    <>
      {items === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState icon={<SearchX />} title={qt.empty[tab] ?? ''} />
          </CardContent>
        </Card>
      ) : tab === 'gaps' ? (
        <ul className="space-y-4">
          {gaps.map((g, i) => (
            <li key={i}>
              <Card>
                <CardContent className="space-y-3 pt-6">
                  <p className="text-base font-medium" dir="auto">
                    {g.question}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{qt.asked(g.count)}</span>
                    {g.open && g.open !== g.count ? <span>· {qt.openOf(g.open, g.count)}</span> : null}
                    <span>· {qt.lastAsked(when(g.last_at))}</span>
                    {g.agents.map((a) => (
                      <Badge key={a} variant="outline">
                        {t.agents[a]}
                      </Badge>
                    ))}
                  </p>
                  {reviewBlock(state === 'open' ? g.open_ids : g.reviewed_ids, g.review, state === 'open' ? g.open_ids : [])}
                  {knowledgeHref ? (
                    <Link href={knowledgeHref} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                      <BookOpen aria-hidden className="size-3.5" />
                      {qt.addDocument}
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-4">
          {flagged.map((f) => (
            <li key={f.id}>
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{t.agents[f.agent]}</Badge>
                    <span>{qt.answeredAt(when(f.answered_at))}</span>
                    {f.rated_at ? <span>· {qt.ratedAt(when(f.rated_at))}</span> : null}
                  </p>
                  <section className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground">{qt.question}</h3>
                    <p className="text-sm whitespace-pre-line" dir="auto">
                      {f.question ?? qt.noQuestion}
                    </p>
                  </section>
                  <section className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground">{qt.answer}</h3>
                    {f.visible && f.answer !== null ? (
                      <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm whitespace-pre-line" dir="auto">
                        {f.answer}
                      </p>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <EyeOff aria-hidden className="size-4 shrink-0" />
                        {qt.withheld}
                      </p>
                    )}
                  </section>
                  {f.visible && f.citations.length ? (
                    <section className="space-y-1">
                      <h3 className="text-xs font-semibold text-muted-foreground">{qt.sources}</h3>
                      <ol className="space-y-2 text-sm">
                        {f.citations.map((c, i) => (
                          <li key={i} className="rounded-md border border-border p-2">
                            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                              <FileText aria-hidden className="size-3.5 text-muted-foreground" />
                              {c.n !== null ? `[${c.n}] ` : ''}
                              <span dir="auto">{c.title ?? t.dash}</span>
                              {c.program ? <span className="text-muted-foreground">· {qt.program}</span> : null}
                              {!c.program && c.page_from !== null ? <span className="text-muted-foreground">· {qt.page(c.page_from, c.page_to)}</span> : null}
                            </p>
                            {c.text ? (
                              <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                                “{c.text}”
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                  {f.comment ? (
                    <section className="space-y-1">
                      <h3 className="text-xs font-semibold text-muted-foreground">{qt.comment}</h3>
                      <p className="text-sm whitespace-pre-line" dir="auto">
                        {f.comment}
                      </p>
                    </section>
                  ) : null}
                  {reviewBlock([f.id], f.review, f.review ? [] : [f.id])}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {items >= limit ? <p className="mt-4 text-xs text-muted-foreground">{qt.showMore}</p> : null}
    </>
  )
}
