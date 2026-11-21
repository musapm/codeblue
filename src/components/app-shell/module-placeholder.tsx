import Link from 'next/link'
import { Construction } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Honest placeholder for modules that are not built yet: states the planned phase and
 * what the module will do. It never shows sample data or fake controls.
 */
export function ModulePlaceholder({
  title,
  description,
  labels,
  backHref,
}: {
  title: string
  description: string
  labels: { planned: string; notBuilt: string; body: string; plannedCapabilities: string; back: string }
  backHref: string
}) {
  return (
    <>
      <PageHeader title={title} badge={<Badge variant="outline">{labels.planned}</Badge>} />
      <Card>
        <CardContent className="flex flex-col items-start gap-5 py-10 md:flex-row md:gap-8">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Construction aria-hidden className="size-6" />
          </div>
          <div className="max-w-2xl space-y-4">
            <div className="space-y-1">
              <p className="font-semibold">{labels.notBuilt}</p>
              <p className="text-sm text-muted-foreground">{labels.body}</p>
            </div>
            <div className="rounded-lg border border-border bg-canvas p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{labels.plannedCapabilities}</p>
              <p className="mt-1.5 text-sm leading-relaxed">{description}</p>
            </div>
            <Link href={backHref} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              {labels.back}
            </Link>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
