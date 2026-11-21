'use client'

import { Mail } from 'lucide-react'
import { useActionState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { Alert } from '@/components/ui/alert'
import { buttonClasses } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { submitInquiry, type ContactActionState } from '@/lib/contact/actions'
import type { Dictionary } from '@/lib/i18n/get-dictionary'

type Props = {
  copy: Dictionary['contactForm']
  validation: Dictionary['validation']
  rateLimitedMessage: string
  optionalLabel: string
}

const initialState: ContactActionState = { status: 'idle' }

export function ContactForm({ copy, validation, rateLimitedMessage, optionalLabel }: Props) {
  const [state, formAction] = useActionState(submitInquiry, initialState)
  const errors = state.status === 'error' ? state.fieldErrors ?? {} : {}
  const err = (field: string) => {
    const key = errors[field]
    return key ? validation[key] : undefined
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === 'not_stored' ? (
        <Alert variant="warning" title={copy.notStoredTitle} role="status">
          <p>{copy.notStoredBody}</p>
          <a href={state.mailto} className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'mt-3' })}>
            <Mail aria-hidden />
            {copy.openEmail}
          </a>
        </Alert>
      ) : null}
      {state.status === 'error' && state.rateLimited ? <Alert variant="danger" role="alert" title={rateLimitedMessage} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={copy.name} error={err('name')}>
          <Input name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label={copy.email} error={err('email')}>
          <Input name="email" type="email" autoComplete="email" required maxLength={254} dir="ltr" />
        </Field>
        <Field label={copy.organization} error={err('organization')}>
          <Input name="organization" autoComplete="organization" required maxLength={160} />
        </Field>
        <Field label={copy.role} optionalLabel={optionalLabel} error={err('role')}>
          <Input name="role" autoComplete="organization-title" maxLength={120} />
        </Field>
        <Field label={copy.country} optionalLabel={optionalLabel} error={err('country')} className="sm:col-span-2">
          <Input name="country" autoComplete="country-name" maxLength={80} />
        </Field>
      </div>
      <Field label={copy.message} error={err('message')}>
        <Textarea name="message" required minLength={20} maxLength={2000} rows={5} />
      </Field>
      <div className="space-y-1.5">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="consent"
            required
            aria-invalid={err('consent') ? true : undefined}
            aria-describedby={err('consent') ? 'consent-error' : undefined}
            className="mt-0.5 size-4 shrink-0 rounded border-input accent-[var(--color-primary)]"
          />
          <span className="text-muted-foreground">{copy.consent}</span>
        </label>
        {err('consent') ? (
          <p id="consent-error" className="text-xs font-medium text-danger">
            {err('consent')}
          </p>
        ) : null}
      </div>
      <SubmitButton pendingLabel={copy.sending}>{copy.submit}</SubmitButton>
    </form>
  )
}
