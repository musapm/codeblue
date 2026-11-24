'use client'

import Link from 'next/link'
import { MapPin, Sparkles } from 'lucide-react'
import { useActionState, useId } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import type { FormMessages } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { askCampusAction } from '@/lib/campus/actions'
import type { CampusAnswer } from '@/lib/campus/ai'
import { idleState, type ActionState } from '@/lib/management/action-state'

/** A campus question answered from the directory only; the places it used link to their pages. */
export function AskCampus({
  tenant,
  locale,
  base,
  labels,
  messages,
}: {
  tenant: string
  locale: 'en' | 'ar'
  /** Localized path of the campus directory; location ids are appended. */
  base: string
  labels: Record<'label' | 'placeholder' | 'submit' | 'submitting' | 'notFound' | 'basedOn' | 'aiLabel' | 'notice', string>
  messages: FormMessages
}) {
  const [state, formAction] = useActionState(askCampusAction, idleState as ActionState<CampusAnswer>)
  const id = useId()
  const fieldError = state.status === 'error' && state.fieldErrors?.question ? (messages.validation[state.fieldErrors.question] ?? messages.validation.invalidValue) : undefined
  const result = state.status === 'success' ? state.data : undefined

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="locale" value={locale} />
        <div className="min-w-60 flex-1 space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium">
            {labels.label}
          </label>
          <Input id={id} name="question" maxLength={500} placeholder={labels.placeholder} dir="auto" aria-invalid={!!fieldError || undefined} />
        </div>
        <SubmitButton variant="secondary" pendingLabel={labels.submitting}>
          <Sparkles aria-hidden />
          {labels.submit}
        </SubmitButton>
      </form>
      {fieldError ? <p className="text-xs font-medium text-danger">{fieldError}</p> : null}
      {state.status === 'error' && !fieldError ? (
        <Alert variant="danger" role="alert">
          {messages.errors[state.error]}
        </Alert>
      ) : null}
      {result ? (
        <div role="status" className="space-y-2 rounded-lg border border-border bg-card p-4" key={state.status === 'success' ? state.at : 0}>
          {result.answer === null ? (
            <p className="text-sm text-muted-foreground">{labels.notFound}</p>
          ) : (
            <>
              <Badge variant="info">{labels.aiLabel}</Badge>
              <p className="text-sm whitespace-pre-line" dir="auto">
                {result.answer}
              </p>
              {result.locations.length ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{labels.basedOn}:</span>
                  {result.locations.map((l) => (
                    <Link key={l.id} href={`${base}/${l.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline" dir="auto">
                      <MapPin aria-hidden className="size-3.5" />
                      {(locale === 'ar' && l.name_ar) || l.name}
                    </Link>
                  ))}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{labels.notice}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
