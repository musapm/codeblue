import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHero({ eyebrow, title, intro, children, className }: { eyebrow?: string; title: string; intro?: string; children?: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b border-border bg-canvas', className)}>
      <div className="container-page py-14 md:py-20">
        <div className="max-w-3xl">
          {eyebrow ? <p className="text-sm font-semibold text-primary">{eyebrow}</p> : null}
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance text-foreground md:text-4xl">{title}</h1>
          {intro ? <p className="mt-4 text-base leading-relaxed text-pretty text-muted-foreground md:text-lg">{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  )
}

export function Section({
  heading,
  subheading,
  children,
  tone = 'default',
  className,
  id,
}: {
  heading?: string
  subheading?: string
  children: ReactNode
  tone?: 'default' | 'muted'
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={cn(tone === 'muted' && 'bg-canvas', className)}>
      <div className="container-page py-14 md:py-20">
        {heading ? (
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-balance text-foreground md:text-3xl">{heading}</h2>
            {subheading ? <p className="mt-3 text-base leading-relaxed text-muted-foreground">{subheading}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  )
}

export function FeatureCard({ icon, title, body, className }: { icon?: ReactNode; title: string; body: string; className?: string }) {
  return (
    <div className={cn('rounded-card border border-border bg-card p-6', className)}>
      {icon ? (
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground [&_svg]:size-5">{icon}</div>
      ) : null}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

export function CtaBanner({ title, body, actions }: { title: string; body: string; actions: ReactNode }) {
  return (
    <section className="bg-secondary text-secondary-foreground">
      <div className="container-page flex flex-col gap-6 py-14 md:flex-row md:items-center md:justify-between md:py-16">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{title}</h2>
          <p className="mt-3 text-base leading-relaxed opacity-85">{body}</p>
        </div>
        <div className="flex flex-wrap gap-3">{actions}</div>
      </div>
    </section>
  )
}

export function LegalDraftNotice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-warning/30 bg-warning-subtle p-4 text-sm text-warning">{children}</div>
}
