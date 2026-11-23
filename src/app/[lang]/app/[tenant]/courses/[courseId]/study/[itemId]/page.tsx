import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Sparkles, Trash2 } from 'lucide-react'
import { FlashcardDeck, PlanChecklist, QuizRunner } from '@/components/academic/study'
import { PageHeader } from '@/components/app-shell/page-header'
import { ActionButton } from '@/components/management/action-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteStudyItem } from '@/lib/academic/actions'
import { getCourse, getQuizReview, getStudyItem } from '@/lib/academic/queries'
import { FlashcardsContent, ItemSources, PlanContent, progressIndexes, QuizContent, SummaryContent } from '@/lib/academic/schemas'
import { courseTitle, materialTitle, sourceLabel } from '@/lib/academic/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** One study aid (private to its owner), always labelled as AI-generated with its sources. */
export default async function StudyItemPage({ params }: PageProps<'/[lang]/app/[tenant]/courses/[courseId]/study/[itemId]'>) {
  const { tenant: slug, courseId, itemId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'academic.use', feature: 'academic_agent' })
  if (!ctx.tenantId) notFound()
  const [course, item] = await Promise.all([getCourse(ctx.tenantId, courseId), getStudyItem(itemId)])
  if (!course || !item || item.course_id !== course.id || item.user_id !== ctx.user.id) notFound()
  const t = dict.academic
  const { canWrite } = writeMode(ctx, dict)
  const sources = ItemSources.parse(item.sources)
  const src = (ref: Parameters<typeof sourceLabel>[3]) => {
    const label = sourceLabel(locale, t, sources, ref)
    return label ? `${t.from}: ${label}` : null
  }
  const dir = item.language === 'ar' ? 'rtl' : 'ltr'
  const back = localizedPath(locale, `/app/${slug}/courses/${course.id}`)

  let body: React.ReactNode = null
  if (item.kind === 'summary') {
    const c = SummaryContent.safeParse(item.content)
    if (!c.success) notFound()
    body = (
      <div className="space-y-6" dir={dir} lang={item.language}>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t.item.overview}</h2>
          <p className="text-sm leading-relaxed whitespace-pre-line">{c.data.overview}</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t.item.keyPoints}</h2>
          <ul className="list-disc space-y-2 ps-5 text-sm">
            {c.data.key_points.map((k, i) => (
              <li key={i}>
                {k.text}
                {src(k.source) ? <span className="block text-xs text-muted-foreground">{src(k.source)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
        {c.data.terms.length ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.item.terms}</h2>
            <dl className="space-y-3 text-sm">
              {c.data.terms.map((term, i) => (
                <div key={i}>
                  <dt className="font-medium">{term.term}</dt>
                  <dd className="text-muted-foreground">{term.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>
    )
  } else if (item.kind === 'quiz') {
    const c = QuizContent.safeParse(item.content)
    if (!c.success) notFound()
    const last = await getQuizReview(item.id)
    const n = c.data.questions.length
    body = (
      <div dir={dir} lang={item.language}>
        <QuizRunner
          itemId={item.id}
          questions={c.data.questions.map((q) => ({ question: q.question, options: q.options, source: src(q.source) }))}
          last={last}
          labels={{
            question: c.data.questions.map((_, i) => t.item.quiz.question(i + 1, n)),
            submit: t.item.quiz.submit,
            checking: t.item.quiz.checking,
            again: t.item.quiz.again,
            score: t.item.quiz.score(-1, -2).replace('-1', '{s}').replace('-2', '{t}'),
            correct: t.item.quiz.correct,
            incorrect: t.item.quiz.incorrect,
            skipped: t.item.quiz.skipped,
            rightAnswer: t.item.quiz.rightAnswer,
            explanation: t.item.quiz.explanation,
            unanswered: Array.from({ length: n + 1 }, (_, k) => t.item.quiz.unanswered(k)),
            lastResult: t.item.quiz.lastResult,
          }}
          errorText={dict.management.errors.generic}
        />
      </div>
    )
  } else if (item.kind === 'flashcards') {
    const c = FlashcardsContent.safeParse(item.content)
    if (!c.success || c.data.cards.length === 0) notFound()
    const total = c.data.cards.length
    body = (
      <div dir={dir} lang={item.language}>
        <FlashcardDeck
          itemId={item.id}
          cards={c.data.cards.map((card) => ({ front: card.front, back: card.back, source: src(card.source) }))}
          initialKnown={progressIndexes(item.state, 'known', total)}
          labels={{
            card: c.data.cards.map((_, i) => t.item.cards.card(i + 1, total)),
            show: t.item.cards.show,
            hide: t.item.cards.hide,
            knew: t.item.cards.knew,
            again: t.item.cards.again,
            known: Array.from({ length: total + 1 }, (_, k) => t.item.cards.known(k, total)),
            allKnown: t.item.cards.allKnown,
            restart: t.item.cards.restart,
            previous: t.item.cards.previous,
            next: t.item.cards.next,
          }}
        />
      </div>
    )
  } else if (item.kind === 'study_plan') {
    const c = PlanContent.safeParse(item.content)
    if (!c.success) notFound()
    const total = c.data.sessions.length
    const day = (ymd: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`))
    body = (
      <div className="space-y-4" dir={dir} lang={item.language}>
        {c.data.exam_date ? <p className="text-sm font-medium">{t.item.plan.exam(day(c.data.exam_date))}</p> : null}
        <PlanChecklist
          itemId={item.id}
          sessions={c.data.sessions.map((s) => ({
            date: day(s.date),
            minutes: t.item.plan.minutes(s.minutes),
            focus: s.focus,
            activities: s.activities,
            sources: s.sources.map((r) => sourceLabel(locale, t, sources, r)).filter((x): x is string => Boolean(x)),
          }))}
          initialDone={progressIndexes(item.state, 'done', total)}
          labels={{ done: t.item.plan.done, progress: Array.from({ length: total + 1 }, (_, k) => t.item.plan.progress(k, total)), study: t.item.plan.study }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.item.back}
      </Link>
      <PageHeader
        title={item.title}
        description={`${courseTitle(locale, course)} · ${t.kinds[item.kind] ?? item.kind} · ${formatDate(locale, item.created_at, true)}`}
        actions={
          canWrite ? (
            <ActionButton
              action={deleteStudyItem}
              hidden={{ tenant: slug, locale, courseId: course.id, itemId: item.id }}
              messages={formMessages(dict)}
              confirmMessage={t.item.deleteConfirm}
              label={t.item.delete}
              icon={<Trash2 aria-hidden />}
              variant="ghost"
            />
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-primary/30 bg-primary-subtle/40 p-4 text-sm" role="note">
        <Badge variant="primary">
          <Sparkles aria-hidden className="size-3.5" />
          {t.aiLabel}
        </Badge>
        <div className="min-w-0 flex-1 space-y-1">
          <p>{t.aiNotice}</p>
          <p className="text-xs text-muted-foreground">
            {t.from}: {sources.map((s) => materialTitle(locale, s)).join(' · ')}
          </p>
        </div>
      </div>
      <Card>
        <CardHeader className="sr-only">
          <CardTitle>{item.title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">{body}</CardContent>
      </Card>
    </div>
  )
}
