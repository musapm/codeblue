import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { QuizResult, type QuizResult as QuizResultT } from './schemas'

/** Read side of the academic assistant. RLS and the academic_* functions decide what is visible. */

const log = logger.child({ module: 'academic' })

function fail(op: string, error: { code?: string }): never {
  log.error('academic.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type Course = Database['public']['Tables']['courses']['Row']
export type StudyItem = Database['public']['Tables']['academic_items']['Row']

// The join code is not a readable column (teachers read it through academic_course_admin).
export const COURSE_COLUMNS =
  'id, tenant_id, code, title, title_ar, description, department_id, term, status, ai_enabled, allow_summaries, allow_quizzes, allow_flashcards, allow_study_plans, instructions, join_open, created_by, created_at, updated_at'

export type MyCourse = Course & { role: 'instructor' | 'student' | null }

/** The courses the person belongs to; academic managers also see every other course (role null). */
export async function listMyCourses(tenantId: string, userId: string): Promise<MyCourse[]> {
  const supabase = await createSupabaseServerClient()
  const [courses, members] = await Promise.all([
    supabase.from('courses').select(COURSE_COLUMNS).eq('tenant_id', tenantId).order('status').order('code').limit(500),
    supabase.from('course_members').select('course_id, role').eq('tenant_id', tenantId).eq('user_id', userId),
  ])
  if (courses.error) fail('courses', courses.error)
  if (members.error) fail('course_members', members.error)
  const roles = new Map((members.data ?? []).map((m) => [m.course_id, m.role as 'instructor' | 'student']))
  return ((courses.data ?? []) as Course[]).map((c) => ({ ...c, role: roles.get(c.id) ?? null }))
}

export async function getCourse(tenantId: string, courseId: string): Promise<Course | null> {
  if (!z.uuid().safeParse(courseId).success) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('courses').select(COURSE_COLUMNS).eq('tenant_id', tenantId).eq('id', courseId).maybeSingle()
  if (error) fail('course', error)
  return (data as Course | null) ?? null
}

export async function getCourseRole(courseId: string, userId: string): Promise<'instructor' | 'student' | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('course_members').select('role').eq('course_id', courseId).eq('user_id', userId).maybeSingle()
  if (error) fail('course_role', error)
  return (data?.role as 'instructor' | 'student' | undefined) ?? null
}

export type CourseMaterial = {
  id: string
  title: string
  titleAr: string | null
  publishedAt: string | null
  archivedAt: string | null
  currentVersionId: string | null
  updatedAt: string
  latest: { id: string; versionNo: number; status: string; errorCode: string | null; fileName: string; pageCount: number | null } | null
}

/** Materials the person may see: all for teachers, published ones for students (RLS). */
export async function listCourseMaterials(courseId: string): Promise<CourseMaterial[]> {
  const supabase = await createSupabaseServerClient()
  const docs = await supabase
    .from('knowledge_documents')
    .select('id, title, title_ar, published_at, archived_at, current_version_id, updated_at')
    .eq('course_id', courseId)
    .order('title')
    .limit(200)
  if (docs.error) fail('course_materials', docs.error)
  const rows = docs.data ?? []
  if (!rows.length) return []
  const versions = await supabase
    .from('knowledge_document_versions')
    .select('id, document_id, version_no, status, error_code, file_name, page_count')
    .in('document_id', rows.map((d) => d.id))
  if (versions.error) fail('course_material_versions', versions.error)
  return rows.map((d) => {
    const latest = (versions.data ?? []).filter((v) => v.document_id === d.id).sort((a, b) => b.version_no - a.version_no)[0]
    return {
      id: d.id,
      title: d.title,
      titleAr: d.title_ar,
      publishedAt: d.published_at,
      archivedAt: d.archived_at,
      currentVersionId: d.current_version_id,
      updatedAt: d.updated_at,
      latest: latest
        ? { id: latest.id, versionNo: latest.version_no, status: latest.status, errorCode: latest.error_code, fileName: latest.file_name, pageCount: latest.page_count }
        : null,
    }
  })
}

export async function listMyStudyItems(courseId: string, userId: string): Promise<Pick<StudyItem, 'id' | 'kind' | 'title' | 'language' | 'created_at' | 'model'>[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('academic_items')
    .select('id, kind, title, language, created_at, model')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) fail('academic_items', error)
  return data ?? []
}

export async function getStudyItem(itemId: string): Promise<StudyItem | null> {
  if (!z.uuid().safeParse(itemId).success) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('academic_items')
    .select('id, tenant_id, course_id, user_id, kind, title, language, content, state, sources, model, created_at, updated_at')
    .eq('id', itemId)
    .maybeSingle()
  if (error) fail('academic_item', error)
  return (data as StudyItem | null) ?? null
}

export async function getQuizReview(itemId: string): Promise<QuizResultT | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('academic_quiz_review', { p_item: itemId })
  if (error) fail('academic_quiz_review', error)
  if (!data) return null
  const parsed = QuizResult.safeParse(data)
  return parsed.success ? parsed.data : null
}

export type CourseAdmin = { join_code: string; join_open: boolean; students: number; instructors: number; can_manage_course: boolean }

export async function getCourseAdmin(courseId: string): Promise<CourseAdmin> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('academic_course_admin', { p_course: courseId })
  if (error) fail('academic_course_admin', error)
  return data as unknown as CourseAdmin
}

export type RosterEntry = { user_id: string; name: string; role: 'instructor' | 'student'; joined_at: string }

export async function getRoster(courseId: string): Promise<RosterEntry[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('academic_course_roster', { p_course: courseId })
  if (error) fail('academic_course_roster', error)
  return (data as unknown as RosterEntry[]) ?? []
}

const Generated = z.object({ summary: z.number().catch(0), quiz: z.number().catch(0), flashcards: z.number().catch(0), study_plan: z.number().catch(0) })

const InsightsSchema = z.object({
  min_students: z.number(),
  students: z.number(),
  active_students: z.number(),
  generated: Generated,
  attempts: z.number(),
  materials: z
    .array(z.object({ document_id: z.string(), title: z.string(), title_ar: z.string().nullable(), answered: z.number(), students: z.number(), accuracy: z.number().nullable() }))
    .catch([]),
})
export type CourseInsights = z.infer<typeof InsightsSchema>

export async function getCourseInsights(courseId: string, days: 7 | 30 | 90): Promise<CourseInsights | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('academic_course_insights', { p_course: courseId, p_days: days })
  if (error) fail('academic_course_insights', error)
  const parsed = InsightsSchema.safeParse(data)
  if (!parsed.success) log.error('academic.invalid_payload', { op: 'academic_course_insights' })
  return parsed.success ? parsed.data : null
}

const OverviewSchema = z.object({
  courses: z.object({ draft: z.number(), active: z.number(), archived: z.number(), ai_enabled: z.number() }),
  students: z.number(),
  generated: Generated,
  attempts: z.number(),
  people: z.number(),
  month_cost_usd: z.number(),
  monthly_budget_usd: z.number(),
  daily_limit: z.number(),
  settings_saved: z.boolean(),
})
export type AcademicOverview = z.infer<typeof OverviewSchema>

export async function getAcademicOverview(slug: string, days: 7 | 30 | 90): Promise<AcademicOverview | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('academic_overview', { p_tenant_slug: slug, p_days: days })
  if (error) fail('academic_overview', error)
  const parsed = OverviewSchema.safeParse(data)
  if (!parsed.success) log.error('academic.invalid_payload', { op: 'academic_overview' })
  return parsed.success ? parsed.data : null
}

/** Member counts per course (teachers and academic managers see the members of their courses). */
export async function courseMemberCounts(courseIds: string[]): Promise<Map<string, { students: number; instructors: number }>> {
  const out = new Map<string, { students: number; instructors: number }>()
  if (!courseIds.length) return out
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('course_members').select('course_id, role').in('course_id', courseIds).limit(20000)
  if (error) fail('course_member_counts', error)
  for (const m of data ?? []) {
    const c = out.get(m.course_id) ?? { students: 0, instructors: 0 }
    if (m.role === 'student') c.students += 1
    else c.instructors += 1
    out.set(m.course_id, c)
  }
  return out
}
