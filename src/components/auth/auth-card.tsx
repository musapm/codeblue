import type { ReactNode } from 'react'
import { Alert } from '@/components/ui/alert'
import type { Dictionary } from '@/lib/i18n/get-dictionary'

/** Title + optional "not configured" notice + form slot, shared by every auth page. */
export function AuthCard({
  title,
  subtitle,
  configured,
  dict,
  children,
}: {
  title: string
  subtitle?: string
  configured: boolean
  dict: Dictionary
  children: ReactNode
}) {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {!configured ? (
        <Alert variant="warning" title={dict.auth.notConfigured.title}>
          {dict.auth.notConfigured.body}
        </Alert>
      ) : null}
      {children}
    </div>
  )
}

export function AuthFormSkeleton() {
  return (
    <div aria-hidden className="space-y-5">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
      <div className="h-10 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}
