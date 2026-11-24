'use client'

import { ArrowLeft, ClipboardCheck, Sparkles } from 'lucide-react'
import { useActionState, useId, useState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import type { FormMessages } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { idleState, type ActionState } from '@/lib/management/action-state'
import { submitRequestAction, suggestFormAction } from '@/lib/workflows/actions'
import type { Suggestion } from '@/lib/workflows/ai'
import { checkAnswers, fieldHelp, fieldLabel, formatAnswer, localized, type AnswerProblem, type AnswerValue, type FormField } from '@/lib/workflows/schemas'

/**
 * A service request form: fill in → review (what will be sent, the confirmation text) →
 * confirm. The answers are checked here for quick feedback and again by the database.
 * Only plain data comes from the server.
 */

export type FormLabels = Record<
  | 'review'
  | 'edit'
  | 'confirmTitle'
  | 'confirmHint'
  | 'defaultConfirmation'
  | 'submit'
  | 'submitting'
  | 'required'
  | 'invalid'
  | 'fixErrors'
  | 'choose'
  | 'prefilled'
  | 'notAnswered'
  | 'optional'
  | 'yes'
  | 'no'
  | 'aiLabel',
  string
>

export type RequestFormData = {
  id: string
  versionId: string
  title: string
  fields: FormField[]
  confirmation: string | null
  confirmationAr: string | null
}

type Values = Record<string, string | boolean>

const initialValues = (fields: FormField[], answers?: Record<string, AnswerValue>): Values =>
  Object.fromEntries(fields.map((f) => [f.key, f.type === 'checkbox' ? answers?.[f.key] === true : answers?.[f.key] !== undefined ? String(answers[f.key]) : '']))

export function RequestForm({
  tenant,
  locale,
  form,
  initialAnswers,
  source = 'form',
  labels,
  messages,
}: {
  tenant: string
  locale: 'en' | 'ar'
  form: RequestFormData
  initialAnswers?: Record<string, AnswerValue>
  source?: 'form' | 'assistant'
  labels: FormLabels
  messages: FormMessages
}) {
  const [values, setValues] = useState<Values>(() => initialValues(form.fields, initialAnswers))
  const [problems, setProblems] = useState<Record<string, AnswerProblem>>({})
  const [stage, setStage] = useState<'edit' | 'review'>('edit')
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [state, formAction] = useActionState(submitRequestAction, idleState as ActionState)
  const baseId = useId()

  const set = (key: string, value: string | boolean) => {
    setValues((v) => ({ ...v, [key]: value }))
    setProblems((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)))
  }

  function review() {
    const checked = checkAnswers(form.fields, values)
    if (!checked.ok) {
      setProblems(checked.problems)
      document.getElementById(`${baseId}-${Object.keys(checked.problems)[0]}`)?.focus()
      return
    }
    setAnswers(checked.answers)
    setStage('review')
  }

  const confirmation = localized(locale, form.confirmation ?? '', form.confirmationAr) || labels.defaultConfirmation
  const serverError = state.status === 'error' ? messages.errors[state.error] : null

  if (stage === 'review') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <ClipboardCheck aria-hidden className="size-5 text-primary" />
          <h3 className="text-base font-semibold">{labels.confirmTitle}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{labels.confirmHint}</p>
        <dl className="divide-y divide-border rounded-lg border border-border">
          {form.fields.map((f) => {
            const text = formatAnswer(locale, f, answers[f.key], { yes: labels.yes, no: labels.no })
            return (
              <div key={f.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
                <dt className="text-sm font-medium" dir="auto">
                  {fieldLabel(locale, f)}
                </dt>
                <dd className={text ? 'text-sm whitespace-pre-line' : 'text-sm text-muted-foreground'}>
                  <span dir="auto">{text || labels.notAnswered}</span>
                </dd>
              </div>
            )
          })}
        </dl>
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm" dir="auto">
          {confirmation}
        </p>
        {serverError ? (
          <Alert variant="danger" role="alert">
            {serverError}
          </Alert>
        ) : null}
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="tenant" value={tenant} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="definitionId" value={form.id} />
          <input type="hidden" name="versionId" value={form.versionId} />
          <input type="hidden" name="source" value={source} />
          <input type="hidden" name="answers" value={JSON.stringify(answers)} />
          <Button type="button" variant="secondary" onClick={() => setStage('edit')}>
            <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
            {labels.edit}
          </Button>
          <SubmitButton pendingLabel={labels.submitting}>{labels.submit}</SubmitButton>
        </form>
      </div>
    )
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        review()
      }}
    >
      {source === 'assistant' ? (
        <Alert variant="info">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="info">{labels.aiLabel}</Badge>
            {labels.prefilled}
          </span>
        </Alert>
      ) : null}
      {Object.keys(problems).length ? (
        <Alert variant="danger" role="alert">
          {labels.fixErrors}
        </Alert>
      ) : null}
      {form.fields.map((f) => (
        <FieldInput
          key={f.key}
          id={`${baseId}-${f.key}`}
          field={f}
          locale={locale}
          value={values[f.key] ?? ''}
          problem={problems[f.key]}
          labels={labels}
          onChange={(v) => set(f.key, v)}
        />
      ))}
      <Button type="submit">{labels.review}</Button>
    </form>
  )
}

function FieldInput({
  id,
  field,
  locale,
  value,
  problem,
  labels,
  onChange,
}: {
  id: string
  field: FormField
  locale: 'en' | 'ar'
  value: string | boolean
  problem?: AnswerProblem
  labels: FormLabels
  onChange: (value: string | boolean) => void
}) {
  const label = fieldLabel(locale, field)
  const help = fieldHelp(locale, field)
  const error = problem ? (problem === 'required' ? labels.required : labels.invalid) : undefined

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-1">
        <label className="flex items-start gap-3 text-sm font-medium" dir="auto">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>{label}</span>
        </label>
        {help ? <p className="ps-7 text-xs text-muted-foreground">{help}</p> : null}
        {error ? (
          <p id={`${id}-error`} className="ps-7 text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  const text = typeof value === 'string' ? value : ''
  const common = { id, value: text, 'aria-invalid': !!error || undefined, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }
  return (
    <Field label={<span dir="auto">{label}</span>} hint={help ?? undefined} error={error} optionalLabel={field.required ? undefined : labels.optional}>
      {field.type === 'textarea' ? (
        <Textarea {...common} rows={4} maxLength={4000} dir="auto" />
      ) : field.type === 'select' ? (
        <Select {...common}>
          <option value="">{labels.choose}</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {localized(locale, o.label, o.label_ar)}
            </option>
          ))}
        </Select>
      ) : field.type === 'number' ? (
        <Input {...common} inputMode="decimal" dir="ltr" className="max-w-48" />
      ) : field.type === 'date' ? (
        <Input {...common} type="date" dir="ltr" className="max-w-48" />
      ) : field.type === 'email' ? (
        <Input {...common} type="email" dir="ltr" maxLength={254} autoComplete="email" />
      ) : (
        <Input {...common} maxLength={200} dir="auto" />
      )}
    </Field>
  )
}

/** The workflow agent: describe the need, get the right form pre-filled, then review and confirm. */
export function ServiceStarter({
  tenant,
  locale,
  forms,
  labels,
  formLabels,
  messages,
}: {
  tenant: string
  locale: 'en' | 'ar'
  forms: RequestFormData[]
  labels: Record<'label' | 'placeholder' | 'submit' | 'submitting' | 'suggested' | 'none' | 'missing' | 'aiLabel' | 'notice', string>
  formLabels: FormLabels
  messages: FormMessages
}) {
  const [state, formAction] = useActionState(suggestFormAction, idleState as ActionState<Suggestion>)
  const id = useId()
  const suggestion = state.status === 'success' ? state.data : undefined
  const form = suggestion?.formId ? forms.find((f) => f.id === suggestion.formId) : undefined
  const fieldError = state.status === 'error' && state.fieldErrors?.text ? (messages.validation[state.fieldErrors.text] ?? messages.validation.invalidValue) : undefined

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="locale" value={locale} />
        <label htmlFor={id} className="block text-sm font-medium">
          {labels.label}
        </label>
        <Textarea id={id} name="text" rows={3} maxLength={2000} placeholder={labels.placeholder} dir="auto" aria-invalid={!!fieldError || undefined} />
        {fieldError ? <p className="text-xs font-medium text-danger">{fieldError}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel={labels.submitting}>
            <Sparkles aria-hidden />
            {labels.submit}
          </SubmitButton>
          <span className="text-xs text-muted-foreground">{labels.notice}</span>
        </div>
      </form>

      {state.status === 'error' && !fieldError ? (
        <Alert variant="danger" role="alert">
          {messages.errors[state.error]}
        </Alert>
      ) : null}

      {suggestion ? (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-live="polite" key={state.status === 'success' ? state.at : 0}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{labels.aiLabel}</Badge>
            <span className="text-sm font-semibold">{form ? `${labels.suggested}: ${form.title}` : labels.none}</span>
          </div>
          {suggestion.note ? (
            <p className="text-sm text-muted-foreground" dir="auto">
              {suggestion.note}
            </p>
          ) : null}
          {form && suggestion.missing.length ? (
            <p className="text-sm">
              <span className="font-medium">{labels.missing} </span>
              {suggestion.missing.map((k) => fieldLabel(locale, form.fields.find((f) => f.key === k)!)).join(locale === 'ar' ? '، ' : ', ')}
            </p>
          ) : null}
          {form ? <RequestForm tenant={tenant} locale={locale} form={form} initialAnswers={suggestion.answers} source="assistant" labels={formLabels} messages={messages} /> : null}
        </section>
      ) : null}
    </div>
  )
}
