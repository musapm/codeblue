'use client'

import { createContext, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { Alert } from '@/components/ui/alert'
import type { ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { idleState, type ActionErrorKey, type ActionState } from '@/lib/management/action-state'

/**
 * Client wrapper for management Server Actions: hidden context fields, a confirmation
 * prompt for destructive actions, translated error/success feedback and field errors.
 * Only plain strings are passed in (dictionary functions cannot cross to the client).
 */

export type FormMessages = {
  errors: Record<ActionErrorKey, string>
  validation: Record<string, string>
  saved?: string
}

type Action<T> = (state: ActionState<T>, formData: FormData) => Promise<ActionState<T>>

const FieldErrorContext = createContext<(name: string) => string | undefined>(() => undefined)

/** Translated validation error for a field of the surrounding ActionForm. */
export function useFieldError(name: string): string | undefined {
  return useContext(FieldErrorContext)(name)
}

function useFeedback<T>(state: ActionState<T>, messages: FormMessages) {
  const fieldError = (name: string) => {
    if (state.status !== 'error' || !state.fieldErrors) return undefined
    const key = state.fieldErrors[name]
    return key ? (messages.validation[key] ?? messages.validation.invalidValue) : undefined
  }
  const error = state.status === 'error' ? messages.errors[state.error] : undefined
  return { fieldError, error }
}

function confirmSubmit(message: string | undefined) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (message && !window.confirm(message)) event.preventDefault()
  }
}

function HiddenFields({ values }: { values?: Record<string, string | undefined> }) {
  return (
    <>
      {Object.entries(values ?? {}).map(([name, value]) => (value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />))}
    </>
  )
}

export function ActionForm<T>({
  action,
  hidden,
  messages,
  confirmMessage,
  resetOnSuccess,
  showSuccess = true,
  renderSuccess,
  className,
  children,
  encType,
}: {
  action: Action<T>
  hidden?: Record<string, string | undefined>
  messages: FormMessages
  confirmMessage?: string
  resetOnSuccess?: boolean
  showSuccess?: boolean
  renderSuccess?: (data: T | undefined) => ReactNode
  className?: string
  children: ReactNode
  encType?: 'multipart/form-data'
}) {
  const [state, formAction] = useActionState(action, idleState as ActionState<T>)
  const ref = useRef<HTMLFormElement>(null)
  const { fieldError, error } = useFeedback(state, messages)

  useEffect(() => {
    if (resetOnSuccess && state.status === 'success') ref.current?.reset()
  }, [state, resetOnSuccess])

  return (
    <form ref={ref} action={formAction} onSubmit={confirmSubmit(confirmMessage)} className={cn('space-y-4', className)} noValidate encType={encType}>
      <HiddenFields values={hidden} />
      {error ? (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {state.status === 'success' && renderSuccess ? renderSuccess(state.data) : null}
      {state.status === 'success' && !renderSuccess && showSuccess && messages.saved ? (
        <Alert variant="success" role="status">
          {messages.saved}
        </Alert>
      ) : null}
      <FieldErrorContext.Provider value={fieldError}>{children}</FieldErrorContext.Provider>
    </form>
  )
}

/** A single-button form (revoke, suspend, toggle…) with inline error feedback. */
export function ActionButton({
  action,
  hidden,
  messages,
  confirmMessage,
  label,
  pendingLabel,
  variant = 'secondary',
  size = 'sm',
  className,
  ariaLabel,
  icon,
}: {
  action: Action<undefined>
  hidden: Record<string, string | undefined>
  messages: FormMessages
  confirmMessage?: string
  label: ReactNode
  pendingLabel?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
  ariaLabel?: string
  icon?: ReactNode
}) {
  const [state, formAction] = useActionState(action, idleState as ActionState)
  const error = state.status === 'error' ? messages.errors[state.error] : undefined
  return (
    <form action={formAction} onSubmit={confirmSubmit(confirmMessage)} className={cn('inline-flex flex-col items-start gap-1', className)}>
      <HiddenFields values={hidden} />
      <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel} aria-label={ariaLabel}>
        {icon}
        {label}
      </SubmitButton>
      {error ? (
        <span role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      ) : null}
    </form>
  )
}
