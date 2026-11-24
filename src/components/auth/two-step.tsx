'use client'

import { useActionState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { Alert } from '@/components/ui/alert'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { confirmTwoStep, removeTwoStep, startTwoStep, verifyTwoStep, type TwoStepState } from '@/lib/auth/two-step-actions'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'

type Copy = Dictionary['auth']['twoStep'] & { loading: string }
const idle: TwoStepState = { status: 'idle' }

function CodeInput({ label }: { label: string }) {
  return (
    <Field label={label}>
      <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required dir="ltr" className="text-center font-mono text-lg tracking-[0.4em]" autoFocus />
    </Field>
  )
}

function ErrorAlert({ state, copy }: { state: TwoStepState; copy: Copy }) {
  return state.status === 'error' ? <Alert variant="danger" role="alert" title={copy.errors[state.error] ?? copy.errors.generic} /> : null
}

/** The code step after the password. */
export function VerifyCodeForm({ locale, next, copy }: { locale: string; next?: string; copy: Copy }) {
  const [state, action] = useActionState(verifyTwoStep, idle)
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <ErrorAlert state={state} copy={copy} />
      <CodeInput label={copy.code} />
      <SubmitButton className="w-full" pendingLabel={copy.loading}>
        {copy.verifySubmit}
      </SubmitButton>
    </form>
  )
}

/** Setting up an authenticator app: start, scan, confirm with a first code. */
export function TwoStepSetup({ next, copy }: { next?: string; copy: Copy }) {
  const [started, start] = useActionState(startTwoStep, idle)
  const [confirmed, confirm] = useActionState(confirmTwoStep, started)
  const current = confirmed.status === 'enrolling' || confirmed.status === 'done' ? confirmed : started

  if (current.status === 'done') return <Alert variant="success" role="status" title={copy.done} />
  if (current.status !== 'enrolling') {
    return (
      <form action={start} className="space-y-4">
        <ErrorAlert state={started} copy={copy} />
        <p className="text-sm text-muted-foreground">{copy.apps}</p>
        <SubmitButton pendingLabel={copy.loading}>{copy.start}</SubmitButton>
      </form>
    )
  }
  return (
    <form action={confirm} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <p className="text-sm">{copy.scan}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL from Supabase Auth */}
      <img src={current.qrCode} alt={copy.qrAlt} width={192} height={192} className="mx-auto size-48 rounded-lg bg-white p-2" />
      <p className="text-center text-xs text-muted-foreground">
        {copy.key}:{' '}
        <code className="break-all select-all" dir="ltr">
          {current.secret}
        </code>
      </p>
      {confirmed !== started && confirmed.status === 'enrolling' ? <Alert variant="danger" role="alert" title={copy.errors.invalidCode} /> : null}
      <CodeInput label={copy.code} />
      <SubmitButton pendingLabel={copy.loading}>{copy.confirm}</SubmitButton>
    </form>
  )
}

export function RemoveTwoStep({ locale, factorId, copy }: { locale: string; factorId: string; copy: Copy }) {
  const [state, action] = useActionState(removeTwoStep, idle)
  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        if (!window.confirm(copy.confirmRemove)) e.preventDefault()
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="factorId" value={factorId} />
      <ErrorAlert state={state} copy={copy} />
      <SubmitButton variant="secondary" pendingLabel={copy.loading}>
        {copy.remove}
      </SubmitButton>
    </form>
  )
}
