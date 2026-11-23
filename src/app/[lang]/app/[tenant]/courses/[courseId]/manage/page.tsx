import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Eye, EyeOff, FileText, KeyRound, Lock, LockOpen, RefreshCw, Trash2, UserMinus } from 'lucide-react'
import { CourseForm, CourseToolsForm, InstructorForm } from '@/components/academic/course-forms'
import { PageHeader } from '@/components/app-shell/page-header'
import { BarList } from '@/components/charts/bar-list'
import { StatTile } from '@/components/charts/figures'
import { AutoRefresh } from '@/components/knowledge/auto-refresh'
import { KnowledgeUploadForm } from '@/components/knowledge/upload-form'
import { ActionButton } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteCourseMaterial, removeCourseMember, setCourseJoin, setMaterialPublished } from '@/lib/academic/actions'
import { getCourse, getCourseAdmin, getCourseInsights, getCourseRole, getRoster, listCourseMaterials } from '@/lib/academic/queries'
import { COURSE_STATUSES } from '@/lib/academic/schemas'
import { courseTitle, materialTitle } from '@/lib/academic/view'
import { formatNumber, formatShare } from '@/lib/analytics/format'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Managing a course: its teachers and academic managers only. */
export default async function ManageCoursePage({ params }: PageProps<'/[lang]/app/[tenant]/courses/[courseId]/manage'>) {
  const { tenant: slug, courseId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'academic.use', feature: 'academic_agent' })
  if (!ctx.tenantId) notFound()
  const course = await getCourse(ctx.tenantId, courseId)
  if (!course) notFound()
  const isManager = hasWorkspacePermission(ctx, 'academic.manage')
  const role = await getCourseRole(course.id, ctx.user.id)
  if (!isManager && role !== 'instructor') notFound()

  const t = dict.academic
  const m = t.manage
  const { canWrite, notice } = writeMode(ctx, dict)
  const messages = formMessages(dict)
  const [admin, roster, materials, insights, departments] = await Promise.all([
    getCourseAdmin(course.id),
    getRoster(course.id),
    listCourseMaterials(course.id),
    getCourseInsights(course.id, 30),
    isManager ? listDepartments(ctx.tenantId) : Promise.resolve([]),
  ])
  const supabase = getSupabaseConfig()
  const archived = course.status === 'archived'
  const busy = materials.some((x) => x.latest && ['uploading', 'queued', 'processing'].includes(x.latest.status))
  const n = (x: number) => formatNumber(locale, x)
  const editable = canWrite && !archived

  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} />
      <Link href={localizedPath(locale, `/app/${slug}/courses/${course.id}`)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {m.back}
      </Link>
      <PageHeader title={`${m.title}: ${courseTitle(locale, course)}`} description={[course.code, course.term, t.statuses[course.status]].filter(Boolean).join(' · ')} />
      {notice ? <Alert variant="info">{notice}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {isManager && canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.details}</CardTitle>
            </CardHeader>
            <CardContent>
              <CourseForm
                tenant={slug}
                locale={locale}
                initial={{
                  id: course.id,
                  code: course.code,
                  title: course.title,
                  titleAr: course.title_ar,
                  description: course.description,
                  term: course.term,
                  departmentId: course.department_id,
                  status: course.status,
                }}
                departments={departments.filter((d) => !d.archivedAt || d.id === course.department_id).map((d) => ({ value: d.id, label: (locale === 'ar' && d.nameAr) || d.name }))}
                statuses={COURSE_STATUSES.map((s) => ({ value: s, label: t.statuses[s] ?? s }))}
                labels={{
                  code: m.code,
                  titleEn: m.titleEn,
                  titleAr: m.titleAr,
                  description: m.description,
                  term: m.term,
                  department: m.department,
                  noDepartment: m.noDepartment,
                  status: m.status,
                  statusHint: m.statusHint,
                  optional: m.optional,
                  submit: m.save,
                  saving: m.saving,
                }}
                messages={messages}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.tools.title}</CardTitle>
            <CardDescription>{m.tools.subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            {editable ? (
              <CourseToolsForm
                courseId={course.id}
                initial={{
                  aiEnabled: course.ai_enabled,
                  allowSummaries: course.allow_summaries,
                  allowQuizzes: course.allow_quizzes,
                  allowFlashcards: course.allow_flashcards,
                  allowStudyPlans: course.allow_study_plans,
                  instructions: course.instructions,
                }}
                kinds={{ summary: t.kinds.summary!, quiz: t.kinds.quiz!, flashcards: t.kinds.flashcards!, study_plan: t.kinds.study_plan! }}
                labels={{ enabled: m.tools.enabled, allowed: m.tools.allowed, instructions: m.tools.instructions, instructionsHint: m.tools.instructionsHint, optional: m.optional, submit: m.save, saving: m.saving }}
                messages={messages}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{course.ai_enabled ? m.tools.enabled : t.course.toolsOff}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.materials.title}</CardTitle>
          <CardDescription>{m.materials.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.materials.empty}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {materials.map((x) => {
                const status = x.latest?.status ?? 'uploading'
                return (
                  <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" dir="auto">
                        {materialTitle(locale, x)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {x.latest?.fileName} · {formatDate(locale, x.updatedAt)}
                      </span>
                    </span>
                    <Badge variant={status === 'ready' ? 'success' : status === 'failed' || status === 'needs_ocr' ? 'danger' : 'info'}>{m.materials.statuses[status] ?? status}</Badge>
                    <Badge variant={x.publishedAt ? 'success' : 'outline'}>{x.publishedAt ? m.materials.published : m.materials.unpublished}</Badge>
                    {editable && x.currentVersionId ? (
                      <ActionButton
                        action={setMaterialPublished}
                        hidden={{ documentId: x.id, published: x.publishedAt ? 'false' : 'true' }}
                        messages={messages}
                        label={x.publishedAt ? m.materials.unpublish : m.materials.publish}
                        icon={x.publishedAt ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      />
                    ) : null}
                    {editable ? (
                      <ActionButton
                        action={deleteCourseMaterial}
                        hidden={{ documentId: x.id }}
                        messages={messages}
                        confirmMessage={m.materials.deleteConfirm}
                        label={m.materials.delete}
                        icon={<Trash2 aria-hidden />}
                        variant="ghost"
                      />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {editable && supabase ? (
            <div className="rounded-lg border border-dashed border-border p-4">
              <h3 className="mb-3 text-sm font-semibold">{m.materials.upload}</h3>
              <KnowledgeUploadForm
                tenant={slug}
                courseId={course.id}
                courseLabels={{ title: m.materials.titleField, titleAr: m.materials.titleArField, optional: m.optional }}
                supabaseUrl={supabase.url}
                supabaseKey={supabase.publishableKey}
                labels={{ file: m.materials.file, submit: m.materials.submit, uploading: m.materials.uploading, verifying: m.materials.verifying, queued: m.materials.queued }}
                messages={messages}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.enrollment.title}</CardTitle>
            <CardDescription>{m.enrollment.codeHint}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <KeyRound aria-hidden className="size-5 text-muted-foreground" />
              <span className="sr-only">{m.enrollment.code}</span>
              <span className="rounded-lg bg-muted px-3 py-1.5 font-mono text-xl font-semibold tracking-[0.3em]" dir="ltr">
                {admin.join_code}
              </span>
              <Badge variant={admin.join_open && course.status === 'active' ? 'success' : 'neutral'}>{admin.join_open ? m.enrollment.open : m.enrollment.closed}</Badge>
            </div>
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  action={setCourseJoin}
                  hidden={{ courseId: course.id, open: admin.join_open ? 'false' : 'true' }}
                  messages={messages}
                  label={admin.join_open ? m.enrollment.close : m.enrollment.reopen}
                  icon={admin.join_open ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
                />
                <ActionButton
                  action={setCourseJoin}
                  hidden={{ courseId: course.id, open: admin.join_open ? 'true' : 'false', rotate: 'true' }}
                  messages={messages}
                  confirmMessage={m.enrollment.rotateConfirm}
                  label={m.enrollment.rotate}
                  icon={<RefreshCw aria-hidden />}
                  variant="ghost"
                />
              </div>
            ) : null}
            <div>
              <h3 className="mb-2 text-sm font-semibold">{m.enrollment.people}</h3>
              {roster.length === 0 ? (
                <p className="text-sm text-muted-foreground">{m.enrollment.empty}</p>
              ) : (
                <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {roster.map((p) => (
                    <li key={p.user_id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        {p.name}
                      </span>
                      <Badge variant={p.role === 'instructor' ? 'info' : 'outline'}>{m.enrollment.roles[p.role] ?? p.role}</Badge>
                      <span className="text-xs text-muted-foreground">{m.enrollment.joined(formatDate(locale, p.joined_at))}</span>
                      {canWrite && p.user_id !== ctx.user.id && (p.role === 'student' || isManager) ? (
                        <ActionButton
                          action={removeCourseMember}
                          hidden={{ courseId: course.id, userId: p.user_id }}
                          messages={messages}
                          confirmMessage={m.enrollment.removeConfirm}
                          label={m.enrollment.remove}
                          icon={<UserMinus aria-hidden />}
                          variant="ghost"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {isManager && canWrite ? (
              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-semibold">{m.instructors.title}</h3>
                <InstructorForm
                  courseId={course.id}
                  labels={{ email: m.instructors.email, hint: m.instructors.hint, submit: m.instructors.submit, saving: m.saving }}
                  messages={{ ...messages, errors: { ...messages.errors, notFound: m.instructors.notFound } }}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.insights.title}</CardTitle>
            <CardDescription>{m.insights.subtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {insights ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label={m.insights.students} value={n(insights.students)} />
                  <StatTile label={m.insights.active} value={n(insights.active_students)} />
                  <StatTile
                    label={m.insights.generated}
                    value={n(insights.generated.summary + insights.generated.quiz + insights.generated.flashcards + insights.generated.study_plan)}
                  />
                  <StatTile label={m.insights.attempts} value={n(insights.attempts)} />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{m.insights.byMaterial}</h3>
                  {insights.materials.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{m.insights.empty}</p>
                  ) : (
                    <>
                      <BarList
                        format={(v) => m.insights.answered(n(v))}
                        emptyLabel={m.insights.empty}
                        rows={insights.materials.map((x) => ({ key: x.document_id, label: materialTitle(locale, x), value: x.answered }))}
                      />
                      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                        {insights.materials.map((x) => (
                          <li key={x.document_id}>
                            <span className="font-medium text-foreground" dir="auto">
                              {materialTitle(locale, x)}
                            </span>
                            {': '}
                            {x.accuracy === null ? m.insights.hidden(insights.min_students) : m.insights.correct(formatShare(locale, x.accuracy, '—'))}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{m.insights.empty}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
