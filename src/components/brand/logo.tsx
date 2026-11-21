import { platformBranding } from '@/lib/branding/platform'
import { cn } from '@/lib/utils'

/** Platform mark: an academic arch with an "insight" dot. Colors follow the theme tokens. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M9.5 23.5V14.5a6.5 6.5 0 0 1 13 0v9" fill="none" className="stroke-primary-foreground" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="15" r="2.3" className="fill-accent" />
    </svg>
  )
}

export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('text-[0.95rem] font-semibold tracking-tight', inverted ? 'text-white' : 'text-foreground')} dir="ltr">
        {platformBranding.name}
      </span>
    </span>
  )
}
