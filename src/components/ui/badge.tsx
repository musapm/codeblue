import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const VARIANTS = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-subtle text-primary-subtle-foreground',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
  outline: 'border border-border text-muted-foreground',
} as const

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof VARIANTS }

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', VARIANTS[variant], className)}
      {...props}
    />
  )
}
