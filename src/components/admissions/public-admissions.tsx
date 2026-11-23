'use client'

import { CheckCircle2, MessageSquare } from 'lucide-react'
import { useActionState, useState, useTransition } from 'react'
import { AssistantChat, type ChatLabels } from '@/components/assistant/chat'
import { SubmitButton } from '@/components/forms/submit-button'
import { TurnstileField } from '@/components/forms/turnstile-field'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { startVisitorSession, submitInquiry, type InquiryState } from '@/lib/admissions/public-actions'
import { publicEnv } from '@/lib/env/public'

/**
 * Interactive part of the public admissions page: the admissions assistant and the inquiry
 * form. Visitors without a session start one (anonymous; Turnstile when configured) before the
 * first question; the inquiry form starts one itself. An inquiry sent after chatting is linked
 * to that conversation (source "assistant"); the conversation stays private to the visitor.
 */

export type InquiryCopy = {
  heading: string
  description: string
  fullName: string
  email: string
  phone: string
  contactHint: string
  country: string
  program: string
  anyProgram: string
  intake: string
  intakeHint: string
  message: string
  optional: string
  privacy: string
  submit: string
  sending: string
  /** Pre-rendered with {reference}. */
  success: string
  errors: Record<string, string>
  validation: Record<string, string>
}

export type AssistantCopy = {
  heading: string
  description: string
  start: string
  starting: string
  disclaimer: string
  leaveDetails: string
  leaveDetailsCta: string
  errors: Record<string, string>
}

export function AdmissionsInteractive({
  tenant,
  locale,
  hasSession,
  assistant,
  inquiry,
}: {
  tenant: string
  locale: 'en' | 'ar'
  hasSession: boolean
  assistant: null | { name: string; welcome: string; copy: AssistantCopy; labels: ChatLabels; programBase: string }
  inquiry: {
    copy: InquiryCopy
    programs: { value: string; label: string }[]
    selectedProgram: string | null
    consent: { text: string; version: string }
    privacyUrl: string | null
  }
}) {
  const [sessionReady, setSessionReady] = useState(hasSession)
  const [conversationId, setConversationId] = useState<string | null>(null)

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {assistant ? (
        <section aria-labelledby="ask-heading" className="space-y-3">
          <h2 id="ask-heading" className="text-xl font-semibold">
            {assistant.copy.heading}
          </h2>
          <p className="text-sm text-muted-foreground">{assistant.copy.description}</p>
          {sessionReady ? (
            <>
              <AssistantChat
                tenant={tenant}
                locale={locale}
                assistantName={assistant.name}
                welcome={assistant.welcome}
                conversationId={null}
                initialMessages={[]}
                unavailable={null}
                labels={assistant.labels}
                endpoint={`/api/admissions/${encodeURIComponent(tenant)}`}
                documentLinks={false}
                programHref={(code) => `${assistant.programBase}/${encodeURIComponent(code)}`}
                onConversation={setConversationId}
              />
              <p className="text-xs text-muted-foreground">{assistant.copy.disclaimer}</p>
              <p className="text-sm">
                {assistant.copy.leaveDetails}{' '}
                <a href="#inquiry" className="font-medium text-primary underline-offset-4 hover:underline">
                  {assistant.copy.leaveDetailsCta}
                </a>
              </p>
            </>
          ) : (
            <StartChat locale={locale} copy={assistant.copy} onStarted={() => setSessionReady(true)} />
          )}
        </section>
      ) : null}

      <section id="inquiry" aria-labelledby="inquiry-heading" className={assistant ? '' : 'lg:col-span-2 lg:max-w-2xl'}>
        <InquiryForm
          tenant={tenant}
          locale={locale}
          needsSession={!sessionReady}
          conversationId={conversationId}
          {...inquiry}
          onSent={() => setSessionReady(true)}
        />
      </section>
    </div>
  )
}

function StartChat({ locale, copy, onStarted }: { locale: string; copy: AssistantCopy; onStarted: () => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const needsToken = Boolean(publicEnv.turnstileSiteKey)

  return (
    <div className="space-y-4 rounded-xl border border-border bg-canvas p-6 text-center">
      <MessageSquare aria-hidden className="mx-auto size-8 text-primary" />
      <div className="flex justify-center">
        <TurnstileField locale={locale} onToken={setToken} />
      </div>
      {error ? (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      <Button
        type="button"
        disabled={pending || (needsToken && !token)}
        onClick={() =>
          start(async () => {
            setError(null)
            const result = await startVisitorSession({ captchaToken: token || undefined })
            if (result.ok) onStarted()
            else setError(copy.errors[result.error] ?? copy.errors.generic!)
          })
        }
      >
        {pending ? copy.starting : copy.start}
      </Button>
    </div>
  )
}

function InquiryForm({
  tenant,
  locale,
  needsSession,
  conversationId,
  copy,
  programs,
  selectedProgram,
  consent,
  privacyUrl,
  onSent,
}: {
  tenant: string
  locale: 'en' | 'ar'
  needsSession: boolean
  conversationId: string | null
  copy: InquiryCopy
  programs: { value: string; label: string }[]
  selectedProgram: string | null
  consent: { text: string; version: string }
  privacyUrl: string | null
  onSent: () => void
}) {
  const [state, action] = useActionState(async (prev: InquiryState, formData: FormData) => {
    const next = await submitInquiry(prev, formData)
    if (next.status === 'success') onSent()
    return next
  }, { status: 'idle' } as InquiryState)
  const fieldError = (name: string) => {
    if (state.status !== 'error') return undefined
    const key = state.fieldErrors?.[name]
    return key ? (copy.validation[key] ?? copy.validation.invalidValue) : undefined
  }

  if (state.status === 'success') {
    return (
      <div role="status" className="space-y-3 rounded-xl border border-border bg-card p-6">
        <CheckCircle2 aria-hidden className="size-8 text-success" />
        <h2 id="inquiry-heading" className="text-xl font-semibold">
          {copy.heading}
        </h2>
        <p className="text-sm">{copy.success.replace('{reference}', state.reference)}</p>
      </div>
    )
  }

  return (
    <form action={action} noValidate className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 id="inquiry-heading" className="text-xl font-semibold">
          {copy.heading}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
      </div>
      <input type="hidden" name="tenant" value={tenant} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="consentVersion" value={consent.version} />
      {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
      {state.status === 'error' && !state.fieldErrors ? (
        <Alert variant="danger" role="alert">
          {copy.errors[state.error] ?? copy.errors.generic}
        </Alert>
      ) : null}
      <Field label={copy.fullName} error={fieldError('fullName')}>
        <Input name="fullName" required minLength={2} maxLength={120} autoComplete="name" dir="auto" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={copy.email} hint={copy.contactHint} error={fieldError('email')} optionalLabel={copy.optional}>
          <Input name="email" type="email" maxLength={254} autoComplete="email" dir="ltr" />
        </Field>
        <Field label={copy.phone} error={fieldError('phone')} optionalLabel={copy.optional}>
          <Input name="phone" type="tel" maxLength={32} autoComplete="tel" dir="ltr" />
        </Field>
        <Field label={copy.program} error={fieldError('programId')} optionalLabel={copy.optional}>
          <Select name="programId" defaultValue={selectedProgram ?? ''}>
            <option value="">{copy.anyProgram}</option>
            {programs.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={copy.intake} hint={copy.intakeHint} error={fieldError('intake')} optionalLabel={copy.optional}>
          <Input name="intake" maxLength={60} dir="auto" />
        </Field>
        <Field label={copy.country} error={fieldError('country')} optionalLabel={copy.optional}>
          <Input name="country" maxLength={80} autoComplete="country-name" dir="auto" />
        </Field>
      </div>
      <Field label={copy.message} error={fieldError('message')} optionalLabel={copy.optional}>
        <Textarea name="message" rows={3} maxLength={2000} dir="auto" />
      </Field>
      <div className="space-y-1">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" required className="mt-1 size-4 shrink-0 accent-primary" aria-invalid={fieldError('consent') ? true : undefined} />
          <span>
            {consent.text}
            {privacyUrl ? (
              <>
                {' '}
                <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
                  {copy.privacy}
                </a>
              </>
            ) : null}
          </span>
        </label>
        {fieldError('consent') ? <p className="text-xs font-medium text-danger">{fieldError('consent')}</p> : null}
      </div>
      {needsSession ? <TurnstileField locale={locale} resetKey={state} /> : null}
      <SubmitButton pendingLabel={copy.sending}>{copy.submit}</SubmitButton>
    </form>
  )
}
