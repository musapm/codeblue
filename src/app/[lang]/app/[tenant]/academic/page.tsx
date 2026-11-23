import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { AcademicSettingsForm, CourseForm } from '@/components/academic/course-forms'
import { PageHeader } from '@/components/app-shell/page-header'
import { Meter, StatTile } from '@/components/charts/figures'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { courseMemberCounts, getAcademicOverview, listMyCourses } from '@/lib/academic/queries'
import { courseTitle, STATUS_VARIANT } from '@/lib/academic/view'
import { formatNumber, formatUsd } from '@/lib/analytics/format'
import { budgetLevel } from '@/lib/analytics/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** The academic assistant for academic managers: courses, budget and activity. */
export default async function AcademicAdminPage({ params }: PageProps<'/[lang]/app/[tenant]/academic'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'academic.manage', feature: 'academic_agent' })
  const t = dict.academic
  const a = t.admin
  const { canWrite, notice } = writeMode(ctx, dict)
  const live = Boolean(ctx.tenantId) && !ctx.user.isPreview
  const [overview, courses, departments] = live
    ? await Promise.all([getAcademicOverview(slug, 30), listMyCourses(ctx.tenantId!, ctx.user.id), listDepartments(ctx.tenantId!)])
    : [null, [], []]
  const counts = await courseMemberCounts(courses.map((c) => c.id))
  const n = (x: number) => formatNumber(locale, x)
  const usd = (x: number) => formatUsd(locale, x)
  const messages = formMessages(dict)
  const base = localizedPath(locale, `/app/${slug}/courses`)
  const level = overview ? budgetLevel(overview.month_cost_usd, overview.monthly_budget_usd) : 'none'

  return (
    <>
      <PageHeader title={a.title} description={a.subtitle} />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      <div className="space-y-6">
        {overview ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label={a.activity.courses} value={n(overview.courses.active)} />
            <StatTile label={a.activity.students} value={n(overview.students)} />
            <StatTile
              label={a.activity.generated}
              value={n(overview.generated.summary + overview.generated.quiz + overview.generated.flashcards + overview.generated.study_plan)}
              detail={a.activity.title}
            />
            <StatTile label={a.activity.attempts} value={n(overview.attempts)} detail={a.activity.title} />
            <StatTile label={a.activity.people} value={n(overview.people)} detail={a.activity.title} />
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{a.courses}</CardTitle>
            </CardHeader>
            <CardContent>
              {courses.length === 0 ? (
                <EmptyState icon={<GraduationCap />} title={a.empty} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        {(['code', 'title', 'term', 'status', 'people', 'tools'] as const).map((k) => (
                          <th key={k} scope="col" className="px-2 py-2 text-start font-medium">
                            {a.columns[k]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {courses.map((c) => {
                        const people = counts.get(c.id) ?? { students: 0, instructors: 0 }
                        return (
                          <tr key={c.id}>
                            <td className="px-2 py-2 font-mono font-semibold" dir="ltr">
                              <Link href={`${base}/${c.id}/manage`} className="text-primary hover:underline">
                                {c.code}
                              </Link>
                            </td>
                            <td className="px-2 py-2" dir="auto">
                              {courseTitle(locale, c)}
                            </td>
                            <td className="px-2 py-2 text-muted-foreground">{c.term ?? '—'}</td>
                            <td className="px-2 py-2">
                              <Badge variant={STATUS_VARIANT[c.status] ?? 'neutral'}>{t.statuses[c.status] ?? c.status}</Badge>
                            </td>
                            <td className="px-2 py-2 text-muted-foreground">{a.people(people.students, people.instructors)}</td>
                            <td className="px-2 py-2">{c.ai_enabled ? a.toolsOn : a.toolsOff}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {canWrite ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{a.create}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CourseForm
                    tenant={slug}
                    locale={locale}
                    departments={departments.filter((d) => !d.archivedAt).map((d) => ({ value: d.id, label: (locale === 'ar' && d.nameAr) || d.name }))}
                    labels={{
                      code: t.manage.code,
                      titleEn: t.manage.titleEn,
                      titleAr: t.manage.titleAr,
                      description: t.manage.description,
                      term: t.manage.term,
                      department: t.manage.department,
                      noDepartment: t.manage.noDepartment,
                      status: t.manage.status,
                      statusHint: t.manage.statusHint,
                      optional: t.manage.optional,
                      submit: a.createSubmit,
                      saving: t.manage.saving,
                    }}
                    messages={messages}
                  />
                </CardContent>
              </Card>
            ) : null}

            {overview ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{a.settings.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {level === 'none' ? (
                    <p className="text-sm text-muted-foreground">{a.settings.spent(usd(overview.month_cost_usd), usd(overview.monthly_budget_usd))}</p>
                  ) : (
                    <Meter
                      label={dict.analytics.dashboard.ai.month}
                      value={overview.month_cost_usd}
                      max={overview.monthly_budget_usd}
                      level={level}
                      valueText={a.settings.spent(usd(overview.month_cost_usd), usd(overview.monthly_budget_usd))}
                      statusText={level === 'over' ? dict.analytics.dashboard.ai.over : dict.analytics.dashboard.ai.warning}
                    />
                  )}
                  {canWrite ? (
                    <AcademicSettingsForm
                      tenant={slug}
                      initial={{ monthlyBudget: overview.monthly_budget_usd, dailyLimit: overview.daily_limit }}
                      labels={{ budget: a.settings.budget, dailyLimit: a.settings.dailyLimit, submit: a.settings.save, saving: t.manage.saving }}
                      messages={messages}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
