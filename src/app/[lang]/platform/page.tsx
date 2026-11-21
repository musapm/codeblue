import Link from 'next/link'
import { ArrowRight, CircleCheck, CircleDashed, CircleAlert } from 'lucide-react'
import { NAV_ICONS } from '@/components/app-shell/nav-icons'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { PLATFORM_NAV } from '@/lib/navigation/workspace-nav'
import { getReadinessChecks } from '@/lib/system/readiness'

export default async function PlatformOverviewPage() {
  const { locale, dict } = await getI18n()
  const t = dict.platform.overview
  const checks = getReadinessChecks()
  const modules = PLATFORM_NAV.flatMap((s) => s.items).filter((i) => i.status === 'planned')

  return (
    <>
      <PageHeader title={dict.platform.title} description={t.intro} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t.readinessTitle}</CardTitle>
            <CardDescription>{t.readinessSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {checks.map((check) => {
                const Icon = check.status === 'configured' ? CircleCheck : check.status === 'planned' ? CircleDashed : CircleAlert
                return (
                  <li key={check.key} className="flex items-center gap-3 px-4 py-3">
                    <Icon
                      aria-hidden
                      className={
                        check.status === 'configured' ? 'size-4 text-success' : check.status === 'planned' ? 'size-4 text-muted-foreground' : 'size-4 text-warning'
                      }
                    />
                    <span className="min-w-0 flex-1 text-sm">{t.checks[check.key]}</span>
                    <Badge variant={check.status === 'configured' ? 'success' : check.status === 'planned' ? 'outline' : 'warning'}>
                      {t.status[check.status]}
                      {check.status !== 'configured' && check.phase ? ` · P${check.phase}` : ''}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Alert variant="info" title={t.nextStepsTitle} className="bg-card">
            {t.nextSteps}
          </Alert>
          <Card>
            <CardContent className="p-2">
              <ul>
                {modules.map((item) => {
                  const Icon = NAV_ICONS[item.icon]
                  return (
                    <li key={item.key}>
                      <Link
                        href={localizedPath(locale, `/platform/${item.segment}`)}
                        className="group flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-muted"
                      >
                        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon aria-hidden className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{dict.platform.items[item.key]}</span>
                          <span className="block truncate text-xs text-muted-foreground">{dict.platform.descriptions[item.key]}</span>
                        </span>
                        <Badge variant="outline">{dict.common.plannedPhase(item.phase)}</Badge>
                        <ArrowRight aria-hidden className="size-4 text-muted-foreground rtl:-scale-x-100" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
