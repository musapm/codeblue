'use client'

import type { ReactElement, ReactNode } from 'react'
import { Field } from '@/components/ui/field'
import { useFieldError } from './action-form'

/** Field inside an ActionForm: shows the translated server-side validation error. */
export function FormField({
  name,
  label,
  hint,
  optionalLabel,
  className,
  children,
}: {
  name: string
  label: ReactNode
  hint?: ReactNode
  optionalLabel?: string
  className?: string
  children: ReactElement<Record<string, unknown>>
}) {
  const error = useFieldError(name)
  return (
    <Field label={label} hint={hint} optionalLabel={optionalLabel} error={error} className={className}>
      {children}
    </Field>
  )
}
