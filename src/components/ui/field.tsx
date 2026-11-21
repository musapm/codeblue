import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type FieldProps = {
  label: ReactNode
  /** The form control. It receives id, aria-describedby and aria-invalid automatically. */
  children: ReactElement<Record<string, unknown>>
  hint?: ReactNode
  error?: ReactNode
  optionalLabel?: string
  className?: string
}

/** Accessible label + control + hint + error wiring for form fields. */
export function Field({ label, children, hint, error, optionalLabel, className }: FieldProps) {
  const generatedId = useId()
  const controlId = (children.props.id as string | undefined) ?? generatedId
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={controlId} className="flex items-baseline justify-between gap-2 text-sm font-medium text-foreground">
        <span>{label}</span>
        {optionalLabel ? <span className="text-xs font-normal text-muted-foreground">{optionalLabel}</span> : null}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
