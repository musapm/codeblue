import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, GraduationCap } from 'lucide-react'
import { ProgramForm } from '@/components/admissions/staff-forms'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { programFormLabels } from '@/lib/admissions/program-labels'
import { listPrograms } from '@/lib/admissions/queries'
import { admissionsOptions, money, programName, PROGRAM_STATUS_VARIANT } from '@/lib/admissions/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function ProgramsPage({ params }: PageProps<'/[lang]/app/[tenant]/admissions/programs'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'programs.manage', feature: 'admissions_agent' })
  const a = dict.admissions
  const { canWrite, notice } = writeMode(ctx, dict)
  const [programs, departments] = ctx.tenantId ? await Promise.all([listPrograms(ctx.tenantId), listDepartments(ctx.tenantId)]) : [[], []]
  if (!ctx.tenantId && !ctx.user.isPreview) notFound()
  const base = localizedPath(locale, `/app/${slug}/admissions/programs`)
  const options = admissionsOptions(dict)

  return (
    <div className="space-y-6">
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>{a.programs.heading}</CardTitle>
          <CardDescription>{a.programs.publishedHint}</CardDescription>
        </CardHeader>
        <CardContent>
          {programs.length === 0 ? (
            <EmptyState icon={<GraduationCap />} title={a.programs.empty} />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {programs.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}/${p.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/60">
                    <GraduationCap aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{programName(locale, p)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[p.code, a.levels[p.level], p.tuition_amount != null && p.tuition_currency ? `${money(locale, p.tuition_amount, p.tuition_currency)} ${a.periods[p.tuition_period ?? ''] ?? ''}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Badge variant={PROGRAM_STATUS_VARIANT[p.status] ?? 'neutral'}>{a.programStatus[p.status] ?? p.status}</Badge>
                    <ArrowRight aria-hidden className="size-4 text-muted-foreground rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{a.programs.add}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgramForm
              hidden={{ tenant: slug, locale }}
              options={{ ...options, departments: departments.filter((d) => !d.archivedAt).map((d) => ({ value: d.id, label: (locale === 'ar' && d.nameAr) || d.name })) }}
              labels={programFormLabels(dict, a.programs.create)}
              messages={formMessages(dict)}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
