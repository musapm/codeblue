'use client'

import { Check, ExternalLink, RotateCcw, X } from 'lucide-react'
import { useState, useTransition } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { generateStudyAidAction, saveStudyProgress, submitQuiz } from '@/lib/academic/actions'
import type { QuizResult } from '@/lib/academic/schemas'
import { openKnowledgeSource } from '@/lib/assistant/actions'
import { cn } from '@/lib/utils'

/** Client parts of the academic assistant. Only plain strings and records come from the server. */

export function OpenMaterialButton({ documentId, labels }: { documentId: string; labels: { open: string; opening: string } }) {
  const [pending, start] = useTransition()
  const [failed, setFailed] = useState(false)
  function open() {
    setFailed(false)
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    start(async () => {
      const result = await openKnowledgeSource({ documentId })
      if (result.status !== 'success' || !result.data) {
        tab?.close()
        setFailed(true)
        return
      }
      if (tab) tab.location.href = result.data.url
      else window.location.href = result.data.url
    })
  }
  return (
    <Button type="button" variant="ghost" size="sm" onClick={open} disabled={pending} aria-invalid={failed || undefined}>
      <ExternalLink aria-hidden className="rtl:-scale-x-100" />
      {pending ? labels.opening : labels.open}
    </Button>
  )
}

type Kind = 'summary' | 'quiz' | 'flashcards' | 'study_plan'

export function GenerateForm({
  tenant,
  locale,
  courseId,
  kinds,
  materials,
  examDates,
  labels,
  messages,
}: {
  tenant: string
  locale: 'en' | 'ar'
  courseId: string
  /** Allowed exam dates (YYYY-MM-DD), computed by the server: tomorrow to 90 days ahead. */
  examDates: { min: string; max: string }
  kinds: { value: Kind; label: string; hint: string }[]
  materials: { id: string; title: string }[]
  labels: Record<'kind' | 'materials' | 'count' | 'examDate' | 'examDateHint' | 'perWeek' | 'minutes' | 'language' | 'submit' | 'generating', string> & {
    languages: Record<string, string>
  }
  messages: FormMessages
}) {
  const [kind, setKind] = useState<Kind>(kinds[0]?.value ?? 'summary')
  const counts = kind === 'quiz' ? [5, 10, 15] : [10, 20, 30]
  return (
    <ActionForm
      action={generateStudyAidAction}
      hidden={{ tenant, locale, courseId, fallbackTitle: kinds.find((k) => k.value === kind)?.label }}
      messages={messages}
      showSuccess={false}
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{labels.kind}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {kinds.map((k) => (
            <label
              key={k.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-subtle/40',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              )}
            >
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="block font-medium">{k.label}</span>
                <span className="block text-xs text-muted-foreground">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{labels.materials}</legend>
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {materials.map((m, i) => (
            <li key={m.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <input type="checkbox" name="documentIds" value={m.id} defaultChecked={i === 0} className="size-4 accent-primary" />
                <span dir="auto">{m.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        {kind === 'quiz' || kind === 'flashcards' ? (
          <FormField name="count" label={labels.count}>
            <Select name="count" defaultValue={String(counts[1])} key={kind}>
              {counts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        {kind === 'study_plan' ? (
          <>
            <FormField name="examDate" label={labels.examDate} hint={labels.examDateHint}>
              <Input name="examDate" type="date" min={examDates.min} max={examDates.max} dir="ltr" />
            </FormField>
            <FormField name="perWeek" label={labels.perWeek}>
              <Select name="perWeek" defaultValue="3">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField name="minutes" label={labels.minutes}>
              <Select name="minutes" defaultValue="45">
                {[30, 45, 60, 90, 120].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        ) : null}
        <FormField name="language" label={labels.language}>
          <Select name="language" defaultValue={locale}>
            {(['en', 'ar'] as const).map((l) => (
              <option key={l} value={l}>
                {labels.languages[l]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <SubmitButton pendingLabel={labels.generating}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}

export function QuizRunner({
  itemId,
  questions,
  last,
  labels,
  errorText,
}: {
  itemId: string
  questions: { question: string; options: string[]; source: string | null }[]
  last: QuizResult | null
  labels: {
    question: string[]
    submit: string
    checking: string
    again: string
    score: string
    correct: string
    incorrect: string
    skipped: string
    rightAnswer: string
    explanation: string
    unanswered: string[]
    lastResult: string
  }
  errorText: string
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null))
  const [result, setResult] = useState<QuizResult | null>(null)
  const [error, setError] = useState(false)
  const [pending, start] = useTransition()
  const missing = answers.filter((a) => a === null).length

  function check() {
    setError(false)
    start(async () => {
      const r = await submitQuiz({ itemId, answers })
      if (r.status === 'success' && r.data) setResult(r.data)
      else setError(true)
    })
  }
  function again() {
    setAnswers(questions.map(() => null))
    setResult(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-6">
      {result ? (
        <p role="status" className="rounded-lg bg-primary-subtle/50 p-4 text-lg font-semibold">
          {labels.score.replace('{s}', String(result.score)).replace('{t}', String(result.total))}
        </p>
      ) : last ? (
        <p className="text-sm text-muted-foreground">
          {labels.lastResult}: {labels.score.replace('{s}', String(last.score)).replace('{t}', String(last.total))}
        </p>
      ) : null}
      <ol className="space-y-6">
        {questions.map((q, i) => {
          const r = result?.results[i]
          return (
            <li key={i}>
              <fieldset className="space-y-3 rounded-xl border border-border p-4" disabled={Boolean(result) || pending}>
                <legend className="px-1 text-xs font-semibold text-muted-foreground">{labels.question[i]}</legend>
                <p className="font-medium" dir="auto">
                  {q.question}
                </p>
                <div className="space-y-2">
                  {q.options.map((o, k) => {
                    const chosen = answers[i] === k
                    const right = r && r.answer === k
                    return (
                      <label
                        key={k}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                          !r && chosen && 'border-primary bg-primary-subtle/40',
                          r && right && 'border-success bg-success-subtle',
                          r && chosen && !right && 'border-danger bg-danger-subtle',
                        )}
                      >
                        <input
                          type="radio"
                          name={`q${i}`}
                          checked={chosen}
                          onChange={() => setAnswers((a) => a.map((v, j) => (j === i ? k : v)))}
                          className="mt-0.5 size-4 accent-primary"
                        />
                        <span dir="auto" className="flex-1">
                          {o}
                        </span>
                        {r && right ? <Check aria-label={labels.rightAnswer} className="size-4 text-success" /> : null}
                        {r && chosen && !right ? <X aria-hidden className="size-4 text-danger" /> : null}
                      </label>
                    )
                  })}
                </div>
                {r ? (
                  <div className="space-y-1 text-sm">
                    <p className={cn('font-semibold', r.correct ? 'text-success' : 'text-danger')}>
                      {r.correct ? labels.correct : r.given === null ? labels.skipped : labels.incorrect}
                    </p>
                    {r.explanation ? (
                      <p dir="auto">
                        <span className="font-medium">{labels.explanation}: </span>
                        {r.explanation}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {q.source ? <p className="text-xs text-muted-foreground">{q.source}</p> : null}
              </fieldset>
            </li>
          )
        })}
      </ol>
      {error ? (
        <Alert variant="danger" role="alert">
          {errorText}
        </Alert>
      ) : null}
      {result ? (
        <Button type="button" variant="secondary" onClick={again}>
          <RotateCcw aria-hidden />
          {labels.again}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={check} disabled={pending}>
            {pending ? labels.checking : labels.submit}
          </Button>
          {missing ? <span className="text-sm text-muted-foreground">{labels.unanswered[missing]}</span> : null}
        </div>
      )}
    </div>
  )
}

export function FlashcardDeck({
  itemId,
  cards,
  initialKnown,
  labels,
}: {
  itemId: string
  cards: { front: string; back: string; source: string | null }[]
  initialKnown: number[]
  labels: { card: string[]; show: string; hide: string; knew: string; again: string; known: string[]; allKnown: string; restart: string; previous: string; next: string }
}) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [known, setKnown] = useState<Set<number>>(() => new Set(initialKnown))
  const [, start] = useTransition()
  const card = cards[index]!

  function persist(next: Set<number>) {
    setKnown(next)
    start(async () => {
      await saveStudyProgress({ itemId, key: 'known', indexes: [...next] })
    })
  }
  function go(to: number) {
    setIndex((to + cards.length) % cards.length)
    setFlipped(false)
  }
  function mark(knew: boolean) {
    const next = new Set(known)
    if (knew) next.add(index)
    else next.delete(index)
    persist(next)
    go(index + 1)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{labels.card[index]}</span>
        <span role="status">{known.size === cards.length ? labels.allKnown : labels.known[known.size]}</span>
      </div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? labels.hide : labels.show}
        className={cn(
          'flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          flipped ? 'border-primary bg-primary-subtle/40' : 'border-border bg-card',
          known.has(index) && !flipped && 'border-success',
        )}
      >
        <span aria-live="polite" className="text-lg font-medium whitespace-pre-line" dir="auto">
          {flipped ? card.back : card.front}
        </span>
        <span className="text-xs text-muted-foreground">{flipped ? labels.hide : labels.show}</span>
      </button>
      {card.source ? <p className="text-xs text-muted-foreground">{card.source}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => go(index - 1)}>
          {labels.previous}
        </Button>
        <Button type="button" size="sm" onClick={() => mark(true)}>
          <Check aria-hidden />
          {labels.knew}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => mark(false)}>
          {labels.again}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => go(index + 1)}>
          {labels.next}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => persist(new Set())} disabled={known.size === 0}>
          <RotateCcw aria-hidden />
          {labels.restart}
        </Button>
      </div>
    </div>
  )
}

export function PlanChecklist({
  itemId,
  sessions,
  initialDone,
  labels,
}: {
  itemId: string
  sessions: { date: string; minutes: string; focus: string; activities: string[]; sources: string[] }[]
  initialDone: number[]
  labels: { done: string; progress: string[]; study: string }
}) {
  const [done, setDone] = useState<Set<number>>(() => new Set(initialDone))
  const [, start] = useTransition()
  function toggle(i: number) {
    const next = new Set(done)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setDone(next)
    start(async () => {
      await saveStudyProgress({ itemId, key: 'done', indexes: [...next] })
    })
  }
  return (
    <div className="space-y-4">
      <p role="status" className="text-sm text-muted-foreground">
        {labels.progress[done.size]}
      </p>
      <ol className="space-y-3">
        {sessions.map((s, i) => (
          <li key={i} className={cn('rounded-xl border border-border p-4', done.has(i) && 'bg-muted/40')}>
            <div className="flex flex-wrap items-start gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} className="size-4 accent-primary" />
                {labels.done}
              </label>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  {s.date} · {s.minutes}
                </p>
                <p className={cn('font-medium', done.has(i) && 'text-muted-foreground line-through')} dir="auto">
                  {s.focus}
                </p>
                {s.activities.length ? (
                  <ul className="list-disc space-y-1 ps-5 text-sm" dir="auto">
                    {s.activities.map((a, k) => (
                      <li key={k}>{a}</li>
                    ))}
                  </ul>
                ) : null}
                {s.sources.length ? (
                  <p className="text-xs text-muted-foreground">
                    {labels.study}: {s.sources.join(' · ')}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
