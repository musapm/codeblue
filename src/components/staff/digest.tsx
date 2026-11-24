'use client'

import Link from 'next/link'
import { AlertTriangle, Lightbulb, Sparkles } from 'lucide-react'
import { useActionState, useId, useState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import type { FormMessages } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/input'
import { idleState, type ActionState } from '@/lib/management/action-state'
import { generateDigestAction, type DigestResult } from '@/lib/staff/actions'

/**
 * Ticket digest: choose a view of your open tickets, get an AI overview. The result is shown
 * once (not stored); ticket references link to the tickets, which re-check access.
 */

type Option = { value: string; label: string }

export type DigestLabels = Record<
  | 'scope'
  | 'department'
  | 'allMyDepartments'
  | 'submit'
  | 'submitting'
  | 'privacy'
  | 'empty'
  | 'overview'
  | 'themes'
  | 'attention'
  | 'suggestions'
  | 'notice'
  | 'aiLabel'
  /** Pre-rendered with {covered} and {total}. */
  | 'coveredSome'
  | 'coveredAll'
  | 'coveredOne',
  string
>

export function DigestPanel({
  tenant,
  locale,
  scopes,
  departments,
  ticketBase,
  labels,
  messages,
}: {
  tenant: string
  locale: 'en' | 'ar'
  scopes: Option[]
  departments: Option[]
  /** Localized path of the staff ticket pages; the ticket id is appended. */
  ticketBase: string
  labels: DigestLabels
  messages: FormMessages
}) {
  const [state, formAction] = useActionState(generateDigestAction, idleState as ActionState<DigestResult>)
  const [scope, setScope] = useState(scopes[0]?.value ?? 'mine')
  const scopeId = useId()
  const departmentId = useId()

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="language" value={locale} />
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label htmlFor={scopeId} className="block text-sm font-medium">
              {labels.scope}
            </label>
            <Select id={scopeId} name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className="min-w-48">
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          {scope === 'department' && departments.length > 1 ? (
            <div className="space-y-1.5">
              <label htmlFor={departmentId} className="block text-sm font-medium">
                {labels.department}
              </label>
              <Select id={departmentId} name="departmentId" defaultValue="" className="min-w-48">
                <option value="">{labels.allMyDepartments}</option>
                {departments.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <SubmitButton pendingLabel={labels.submitting}>
            <Sparkles aria-hidden />
            {labels.submit}
          </SubmitButton>
        </div>
        <p className="text-xs text-muted-foreground">{labels.privacy}</p>
      </form>

      {state.status === 'error' ? (
        <Alert variant="danger" role="alert">
          {messages.errors[state.error]}
        </Alert>
      ) : null}

      {state.status === 'success' && state.data ? <DigestView result={state.data} ticketBase={ticketBase} labels={labels} locale={locale} key={state.at} /> : null}
    </div>
  )
}

export function DigestView({ result, ticketBase, labels, locale }: { result: DigestResult; ticketBase: string; labels: DigestLabels; locale: 'en' | 'ar' }) {
  const { digest, total, covered } = result
  const format = (x: number) => new Intl.NumberFormat(locale).format(x)
  if (!digest) {
    return (
      <p role="status" className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {labels.empty}
      </p>
    )
  }
  const coveredText =
    covered < total
      ? labels.coveredSome.replace('{covered}', format(covered)).replace('{total}', format(total))
      : total === 1
        ? labels.coveredOne
        : labels.coveredAll.replace('{total}', format(total))
  const ref = (t: { id: string; reference: string }) => (
    <Link key={t.id} href={`${ticketBase}/${t.id}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground hover:bg-primary-subtle hover:text-primary-subtle-foreground" dir="ltr">
      {t.reference}
    </Link>
  )

  return (
    <section aria-label={labels.overview} className="space-y-5 rounded-xl border border-border bg-card p-5" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">{labels.aiLabel}</Badge>
        <span className="text-xs text-muted-foreground">{coveredText}</span>
      </div>
      <p className="text-xs text-muted-foreground">{labels.notice}</p>

      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold">{labels.overview}</h3>
        <p className="text-sm leading-relaxed whitespace-pre-line" dir="auto">
          {digest.overview}
        </p>
      </div>

      {digest.attention.length > 0 ? (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangle aria-hidden className="size-4 text-warning" />
            {labels.attention}
          </h3>
          <ul className="space-y-2">
            {digest.attention.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                {ref(a)}
                <span dir="auto">{a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {digest.themes.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{labels.themes}</h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {digest.themes.map((th, i) => (
              <li key={i} className="space-y-1.5 rounded-lg border border-border p-3">
                <p className="text-sm font-medium" dir="auto">
                  {th.title}
                </p>
                <p className="text-sm text-muted-foreground" dir="auto">
                  {th.summary}
                </p>
                {th.tickets.length > 0 ? <p className="flex flex-wrap gap-1.5">{th.tickets.map(ref)}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {digest.suggestions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Lightbulb aria-hidden className="size-4 text-primary" />
            {labels.suggestions}
          </h3>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {digest.suggestions.map((s, i) => (
              <li key={i} dir="auto">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
