import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText, LogOut, Settings2, Sparkles } from 'lucide-react'
import { GenerateForm, OpenMaterialButton } from '@/components/academic/study'
import { PageHeader } from '@/components/app-shell/page-header'
import { ActionButton } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { removeCourseMember } from '@/lib/academic/actions'
import { getCourse, getCourseRole, listCourseMaterials, listMyStudyItems } from '@/lib/academic/queries'
import { STUDY_KINDS, type StudyKind } from '@/lib/academic/schemas'
import { courseTitle, examDateRange, materialTitle } from '@/lib/academic/view'
import { getAiConfig } from '@/lib/ai/config'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

const ALLOWED: Record<StudyKind, 'allow_summaries' | 'allow_quizzes' | 'allow_flashcards' | 'allow_study_plans'> = {
  summary: 'allow_summaries',
  quiz: 'allow_quizzes',
  flashcards: 'allow_flashcards',
  study_plan: 'allow_study_plans',
}

/** A course: its published materials, the study tools (when switched on) and one's own study aids. */
export default async function CoursePage({ params }: PageProps<'/[lang]/app/[tenant]/courses/[courseId]'>) {
  const { tenant: slug, courseId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'academic.use', feature: 'academic_agent' })
  if (!ctx.tenantId) notFound()
  const course = await getCourse(ctx.tenantId, courseId)
  if (!course) notFound()
  const t = dict.academic
  const { canWrite } = writeMode(ctx, dict)
  const [role, materials, items] = await Promise.all([getCourseRole(course.id, ctx.user.id), listCourseMaterials(course.id), listMyStudyItems(course.id, ctx.user.id)])
  const teacher = role === 'instructor' || hasWorkspacePermission(ctx, 'academic.manage')
  const published = materials.filter((m) => m.publishedAt && m.currentVersionId && !m.archivedAt)
  // Teachers may try the tools on processed materials before publishing them.
  const usable = teacher ? materials.filter((m) => m.currentVersionId && !m.archivedAt) : published
  const kinds = STUDY_KINDS.filter((k) => course[ALLOWED[k]])
  const base = localizedPath(locale, `/app/${slug}/courses`)
  const messages = formMessages(dict)
  const examDates = examDateRange()
  const toolsBlocked =
    course.status === 'archived' || !course.ai_enabled || kinds.length === 0
      ? t.course.toolsOff
      : !getAiConfig().configured
        ? t.course.notConfigured
        : usable.length === 0
          ? t.course.noMaterials
          : null

  return (
    <div className="space-y-6">
      <Link href={base} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.myCourses.title}
      </Link>
      <PageHeader
        title={courseTitle(locale, course)}
        description={[course.code, course.term].filter(Boolean).join(' · ')}
        actions={
          teacher ? (
            <Link href={`${base}/${course.id}/manage`} className={buttonClasses({ variant: 'secondary' })}>
              <Settings2 aria-hidden />
              {t.course.manage}
            </Link>
          ) : role === 'student' && canWrite ? (
            <ActionButton
              action={removeCourseMember}
              hidden={{ tenant: slug, locale, courseId: course.id, userId: ctx.user.id }}
              messages={messages}
              confirmMessage={t.course.leaveConfirm}
              label={t.course.leave}
              icon={<LogOut aria-hidden className="rtl:-scale-x-100" />}
              variant="ghost"
            />
          ) : undefined
        }
      />
      {course.description ? (
        <p className="max-w-3xl text-sm whitespace-pre-line text-muted-foreground" dir="auto">
          {course.description}
        </p>
      ) : null}
      {teacher ? <Alert variant="info">{t.course.teacherView}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles aria-hidden className="size-4" />
                {t.course.tools}
              </CardTitle>
              <CardDescription>{t.course.toolsSubtitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">{t.aiNotice}</p>
              {toolsBlocked ? (
                <Alert variant="info">{toolsBlocked}</Alert>
              ) : canWrite ? (
                <GenerateForm
                  tenant={slug}
                  locale={locale}
                  courseId={course.id}
                  kinds={kinds.map((k) => ({ value: k, label: t.kinds[k] ?? k, hint: t.kindHints[k] ?? '' }))}
                  materials={usable.map((m) => ({ id: m.id, title: materialTitle(locale, m) }))}
                  examDates={examDates}
                  labels={{
                    kind: t.course.kind,
                    materials: t.course.materialsPick,
                    count: t.course.count,
                    examDate: t.course.examDate,
                    examDateHint: t.course.examDateHint,
                    perWeek: t.course.perWeek,
                    minutes: t.course.minutes,
                    language: t.course.language,
                    submit: t.course.submit,
                    generating: t.course.generating,
                    languages: t.course.languages,
                  }}
                  messages={messages}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.course.myItems}</CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.course.myItemsEmpty}</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {items.map((i) => (
                    <li key={i.id}>
                      <Link href={`${base}/${course.id}/study/${i.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/50">
                        <Badge variant="outline">{t.kinds[i.kind] ?? i.kind}</Badge>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                          {i.title}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Sparkles aria-hidden className="size-3.5" />
                          {t.aiLabel}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDate(locale, i.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t.course.materials}</CardTitle>
          </CardHeader>
          <CardContent>
            {published.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.course.materialsEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {published.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 rounded-lg border border-border p-2 ps-3">
                    <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" dir="auto">
                        {materialTitle(locale, m)}
                      </span>
                      {m.latest?.pageCount ? <span className="block text-xs text-muted-foreground">{t.course.pageCount(m.latest.pageCount)}</span> : null}
                    </span>
                    <OpenMaterialButton documentId={m.id} labels={{ open: t.course.open, opening: t.course.opening }} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
