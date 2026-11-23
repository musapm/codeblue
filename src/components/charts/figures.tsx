import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Figures for numbers that need no chart (dataviz guide): stat tiles and budget meters.
 * Large values use proportional figures (no tabular-nums); labels are sentence case.
 */

export function StatTile({ label, value, detail, href, className }: { label: string; value: string; detail?: ReactNode; href?: string; className?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </>
  )
  const box = 'block rounded-xl border border-border bg-card p-4'
  return href ? (
    <Link href={href} className={cn(box, 'transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      {body}
    </Link>
  ) : (
    <div className={cn(box, className)}>{body}</div>
  )
}

/**
 * A ratio against a limit. The track is a light step of the fill's hue; the fill turns to the
 * warning and danger status colors near and over the limit, always with an icon and text.
 */
export function Meter({
  label,
  value,
  max,
  valueText,
  level,
  statusText,
}: {
  label: string
  value: number
  max: number
  valueText: string
  level: 'normal' | 'warning' | 'over'
  statusText?: string
}) {
  const share = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{valueText}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-valuetext={valueText}
        className={cn('h-2 overflow-hidden rounded-full', level === 'over' ? 'bg-danger/15' : level === 'warning' ? 'bg-warning/15' : 'bg-primary/15')}
      >
        <div
          className={cn('h-full rounded-full', level === 'over' ? 'bg-danger' : level === 'warning' ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${share === 0 ? 0 : Math.max(2, share * 100)}%` }}
        />
      </div>
      {statusText && level !== 'normal' ? (
        <p className={cn('flex items-center gap-1.5 text-xs font-medium', level === 'over' ? 'text-danger' : 'text-warning')}>
          <AlertTriangle aria-hidden className="size-3.5" />
          {statusText}
        </p>
      ) : null}
    </div>
  )
}
