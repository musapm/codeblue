import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const controlBase = cn(
  'w-full rounded-lg border border-input bg-background text-sm text-foreground shadow-xs transition-colors',
  'placeholder:text-muted-foreground/80',
  'focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/60',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger/40',
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(controlBase, 'h-10 px-3', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(controlBase, 'min-h-28 px-3 py-2 leading-relaxed', className)} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(controlBase, 'h-10 px-3 pe-8', className)} {...props} />
})
