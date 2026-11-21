import Link from 'next/link'
import { ArrowRight, MessageSquareText } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getWorkspaceContext } from '@/lib/tenancy/context'

export default async function WorkspaceOverviewPage({ params }: PageProps<'/[lang]/app/[tenant]'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const { tenant } = await getWorkspaceContext(locale, slug)
  const t = dict.workspace.overview
  const base = localizedPath(locale, `/app/${tenant.slug}`)

  return (
    <>
      <PageHeader title={t.title(tenant.name)} description={t.intro} />

      <Alert variant="info" className="mb-6">
        {t.noFakeData}
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t.setupTitle}</CardTitle>
            <CardDescription>{t.setupSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y divide-border rounded-lg border border-border">
              {t.steps.map((step, i) => (
                <li key={step.title}>
                  <Link href={`${base}/${step.href}`} className="group flex items-start gap-4 p-4 transition-colors hover:bg-muted/60">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{step.title}</span>
                        <Badge variant="outline">{dict.common.plannedPhase(step.phase)}</Badge>
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">{step.body}</span>
                    </span>
                    <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card className="h-fit overflow-hidden">
          <div className="flex items-center gap-3 bg-secondary px-5 py-4 text-secondary-foreground">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{tenant.monogram}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{tenant.assistantName}</p>
              <p className="truncate text-xs opacity-75">{tenant.name}</p>
            </div>
          </div>
          <CardContent className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              {tenant.welcome}
            </p>
            <Link href={`${base}/settings/branding`} className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'w-full' })}>
              {dict.workspace.settings.tabs.branding}
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
