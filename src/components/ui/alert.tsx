import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const VARIANTS = {
  info: { classes: 'border-info/25 bg-info-subtle text-info', Icon: Info },
  success: { classes: 'border-success/25 bg-success-subtle text-success', Icon: CircleCheck },
  warning: { classes: 'border-warning/25 bg-warning-subtle text-warning', Icon: TriangleAlert },
  danger: { classes: 'border-danger/25 bg-danger-subtle text-danger', Icon: CircleAlert },
} as const

type AlertProps = {
  variant?: keyof typeof VARIANTS
  title?: ReactNode
  children?: ReactNode
  className?: string
  /** Use "alert" for errors announced immediately; "status" for polite updates. */
  role?: 'alert' | 'status'
}

export function Alert({ variant = 'info', title, children, className, role }: AlertProps) {
  const { classes, Icon } = VARIANTS[variant]
  return (
    <div role={role} className={cn('flex gap-3 rounded-lg border p-4 text-sm', classes, className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-foreground/80">{children}</div> : null}
      </div>
    </div>
  )
}
