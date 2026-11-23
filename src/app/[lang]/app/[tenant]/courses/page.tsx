import Link from 'next/link'
import { GraduationCap, Settings2, Sparkles } from 'lucide-react'
import { JoinForm } from '@/components/academic/course-forms'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { listMyCourses } from '@/lib/academic/queries'
import { courseTitle, STATUS_VARIANT } from '@/lib/academic/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** My courses: the courses a person studies or teaches, and joining with a course code. */
export default async function MyCoursesPage({ params }: PageProps<'/[lang]/app/[tenant]/courses'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'academic.use', feature: 'academic_agent' })
  const t = dict.academic
  const { canWrite, notice } = writeMode(ctx, dict)
  const courses = ctx.tenantId ? await listMyCourses(ctx.tenantId, ctx.user.id) : []
  const mine = courses.filter((c) => c.role !== null)
  const managed = courses.filter((c) => c.role === null)
  const base = localizedPath(locale, `/app/${slug}`)
  const isManager = hasWorkspacePermission(ctx, 'academic.manage')

  const list = (items: typeof courses) => (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`${base}/courses/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/50">
            <span className="w-20 shrink-0 font-mono text-sm font-semibold" dir="ltr">
              {c.code}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" dir="auto">
                {courseTitle(locale, c)}
              </span>
              {c.term ? <span className="block text-xs text-muted-foreground">{c.term}</span> : null}
            </span>
            {c.role ? <Badge variant={c.role === 'instructor' ? 'info' : 'outline'}>{c.role === 'instructor' ? t.myCourses.teaching : t.myCourses.enrolled}</Badge> : null}
            {c.status !== 'active' ? <Badge variant={STATUS_VARIANT[c.status] ?? 'neutral'}>{t.statuses[c.status] ?? c.status}</Badge> : null}
            {c.ai_enabled && c.status === 'active' ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles aria-hidden className="size-3.5" />
                {t.myCourses.toolsOn}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <PageHeader
        title={t.myCourses.title}
        description={t.myCourses.subtitle}
        actions={
          isManager ? (
            <Link href={`${base}/academic`} className={buttonClasses({ variant: 'secondary' })}>
              <Settings2 aria-hidden />
              {t.myCourses.manageAll}
            </Link>
          ) : undefined
        }
      />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">{mine.length === 0 ? <EmptyState icon={<GraduationCap />} title={t.myCourses.empty} /> : list(mine)}</CardContent>
          </Card>
          {managed.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.myCourses.managed}</CardTitle>
              </CardHeader>
              <CardContent>{list(managed)}</CardContent>
            </Card>
          ) : null}
        </div>
        {canWrite ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t.myCourses.join}</CardTitle>
              <CardDescription>{t.myCourses.joinHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <JoinForm
                tenant={slug}
                locale={locale}
                labels={{ code: t.myCourses.code, hint: '', submit: t.myCourses.joinSubmit, joining: t.myCourses.joining }}
                messages={formMessages(dict)}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}

