'use client'

import Link from 'next/link'
import { MailCheck } from 'lucide-react'
import { useActionState, type ReactNode } from 'react'
import { PasswordInput } from '@/components/auth/password-input'
import { SubmitButton } from '@/components/forms/submit-button'
import { TurnstileField } from '@/components/forms/turnstile-field'
import { Alert } from '@/components/ui/alert'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { requestPasswordReset, signIn, signUp, updatePassword } from '@/lib/auth/actions'
import { initialAuthState, type AuthActionState } from '@/lib/auth/state'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import type { Locale } from '@/lib/i18n/config'

export type AuthCopy = {
  auth: Dictionary['auth']
  validation: Dictionary['validation']
  loading: string
}

type CommonProps = {
  locale: Locale
  copy: AuthCopy
  /** False when no auth backend exists; the form is shown but disabled. */
  enabled: boolean
}

function useFieldError(state: AuthActionState, copy: AuthCopy) {
  return (field: string) => {
    const key = state.fieldErrors?.[field]
    return key ? copy.validation[key] : undefined
  }
}

function FormError({ state, copy }: { state: AuthActionState; copy: AuthCopy }) {
  if (state.status !== 'error' || !state.error) return null
  return <Alert variant="danger" role="alert" title={copy.auth.errors[state.error]} />
}

function SuccessPanel({ title, body, footer }: { title: string; body: string; footer?: ReactNode }) {
  return (
    <div role="status" className="space-y-4 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-subtle text-success">
        <MailCheck aria-hidden className="size-6" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {footer}
    </div>
  )
}

export function LoginForm({ locale, copy, enabled, next }: CommonProps & { next?: string }) {
  const [state, action] = useActionState(signIn, initialAuthState)
  const err = useFieldError(state, copy)
  const t = copy.auth

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormError state={state} copy={copy} />
      <fieldset disabled={!enabled} className="space-y-5 disabled:opacity-60">
        <Field label={t.email} error={err('email')}>
          <Input name="email" type="email" autoComplete="email" required defaultValue={state.email} dir="ltr" />
        </Field>
        <div className="space-y-1.5">
          <Field label={t.password} error={err('password')}>
            <PasswordInput name="password" autoComplete="current-password" required showLabel={t.showPassword} hideLabel={t.hidePassword} />
          </Field>
          <div className="flex justify-end">
            <Link href={`/${locale}/forgot-password`} className="text-sm font-medium text-primary hover:underline">
              {t.login.forgot}
            </Link>
          </div>
        </div>
        <TurnstileField locale={locale} resetKey={state} />
        <SubmitButton className="w-full" pendingLabel={copy.loading}>
          {t.login.submit}
        </SubmitButton>
      </fieldset>
      <p className="text-center text-sm text-muted-foreground">
        {t.login.noAccount}{' '}
        <Link href={`/${locale}/register${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary hover:underline">
          {t.login.createAccount}
        </Link>
      </p>
    </form>
  )
}

export function RegisterForm({ locale, copy, enabled, next }: CommonProps & { next?: string }) {
  const [state, action] = useActionState(signUp, initialAuthState)
  const err = useFieldError(state, copy)
  const t = copy.auth

  if (state.status === 'success') {
    return <SuccessPanel title={t.register.successTitle} body={t.register.successBody} />
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormError state={state} copy={copy} />
      <fieldset disabled={!enabled} className="space-y-5 disabled:opacity-60">
        <Field label={t.register.fullName} error={err('fullName')}>
          <Input name="fullName" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label={t.email} error={err('email')}>
          <Input name="email" type="email" autoComplete="email" required defaultValue={state.email} dir="ltr" />
        </Field>
        <Field label={t.password} hint={t.passwordHint} error={err('password')}>
          <PasswordInput name="password" autoComplete="new-password" required minLength={10} maxLength={72} showLabel={t.showPassword} hideLabel={t.hidePassword} />
        </Field>
        <p className="text-xs text-muted-foreground">{t.register.agreement}</p>
        <TurnstileField locale={locale} resetKey={state} />
        <SubmitButton className="w-full" pendingLabel={copy.loading}>
          {t.register.submit}
        </SubmitButton>
      </fieldset>
      <p className="text-center text-sm text-muted-foreground">
        {t.register.haveAccount}{' '}
        <Link href={`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary hover:underline">
          {t.register.signIn}
        </Link>
      </p>
    </form>
  )
}

export function ForgotPasswordForm({ locale, copy, enabled }: CommonProps) {
  const [state, action] = useActionState(requestPasswordReset, initialAuthState)
  const err = useFieldError(state, copy)
  const t = copy.auth
  const back = (
    <Link href={`/${locale}/login`} className="inline-block text-sm font-medium text-primary hover:underline">
      {t.forgot.backToLogin}
    </Link>
  )

  if (state.status === 'success') {
    return <SuccessPanel title={t.forgot.successTitle} body={t.forgot.successBody} footer={back} />
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <FormError state={state} copy={copy} />
      <fieldset disabled={!enabled} className="space-y-5 disabled:opacity-60">
        <Field label={t.email} error={err('email')}>
          <Input name="email" type="email" autoComplete="email" required defaultValue={state.email} dir="ltr" />
        </Field>
        <TurnstileField locale={locale} resetKey={state} />
        <SubmitButton className="w-full" pendingLabel={copy.loading}>
          {t.forgot.submit}
        </SubmitButton>
      </fieldset>
      <p className="text-center">{back}</p>
    </form>
  )
}

export function ResetPasswordForm({ locale, copy, enabled }: CommonProps) {
  const [state, action] = useActionState(updatePassword, initialAuthState)
  const err = useFieldError(state, copy)
  const t = copy.auth

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {state.status === 'error' && state.error === 'linkExpired' ? (
        <Alert variant="danger" role="alert" title={t.reset.sessionRequired}>
          <Link href={`/${locale}/forgot-password`} className="font-medium text-primary hover:underline">
            {t.reset.requestNew}
          </Link>
        </Alert>
      ) : (
        <FormError state={state} copy={copy} />
      )}
      <fieldset disabled={!enabled} className="space-y-5 disabled:opacity-60">
        <Field label={t.reset.newPassword} hint={t.passwordHint} error={err('password')}>
          <PasswordInput name="password" autoComplete="new-password" required minLength={10} maxLength={72} showLabel={t.showPassword} hideLabel={t.hidePassword} />
        </Field>
        <Field label={t.reset.confirmPassword} error={err('confirmPassword')}>
          <PasswordInput name="confirmPassword" autoComplete="new-password" required showLabel={t.showPassword} hideLabel={t.hidePassword} />
        </Field>
        <SubmitButton className="w-full" pendingLabel={copy.loading}>
          {t.reset.submit}
        </SubmitButton>
      </fieldset>
    </form>
  )
}
