import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-border', className)} />
}

/** Initials avatar (no external images, so nothing leaks to third parties). */
export function Avatar({ label, className, style }: { label: string; className?: string; style?: CSSProperties }) {
  // Arabic letters change shape when joined, so two initials can read as an unrelated
  // word (e.g. "ما"). Use a single initial for Arabic-script names.
  const isArabic = /[؀-ۿ]/.test(label)
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, isArabic ? 1 : 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return (
    <span
      aria-hidden
      style={style}
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-subtle-foreground', className)}
    >
      {initials || '?'}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-card border border-dashed border-border px-6 py-12 text-center', className)}>
      {icon ? <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      <div className="max-w-md space-y-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
