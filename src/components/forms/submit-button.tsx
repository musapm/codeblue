'use client'

import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'

/** Submit button that reflects the parent form's pending state. */
export function SubmitButton({ children, pendingLabel, disabled, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} {...props}>
      {pending ? <Spinner label={pendingLabel} /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
