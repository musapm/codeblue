import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions, badge }: { title: string; description?: string; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h1>
          {badge}
        </div>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  )
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-canvas" aria-busy="true">
      <div className="hidden w-64 shrink-0 border-e border-border bg-background p-3 lg:block">
        <div className="h-12 animate-pulse rounded-lg bg-muted" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="h-14 border-b border-border bg-background" />
        <div className="mx-auto max-w-6xl space-y-4 p-8">
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded-card bg-muted" />
        </div>
      </div>
    </div>
  )
}
