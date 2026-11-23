'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, log, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionErrorKey, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import type { Json } from '@/lib/supabase/database.types'
import { generateStudyAid, type StudyAidError } from './ai'
import { academicSettingsSchema, courseAiSchema, courseSchema, generateSchema, instructorSchema, joinSchema, QuizResult, type QuizResult as QuizResultT } from './schemas'

/** Academic assistant Server Actions. The academic_* functions and RLS authorize every call again. */

const uuid = z.uuid()

export async function createCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = courseSchema.safeParse(formValues(formData, ['code', 'title', 'titleAr', 'description', 'term', 'departmentId'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { data, error } = await ctx.supabase.rpc('academic_create_course', {
    p_tenant_slug: slug.data,
    p_code: parsed.data.code,
    p_title: parsed.data.title,
    p_title_ar: parsed.data.titleAr,
    p_description: parsed.data.description,
    p_department: parsed.data.departmentId,
    p_term: parsed.data.term,
  })
  if (error) return error.code === '23505' ? errorState('invalid', { code: 'courseCodeTaken' }) : dbFailure('academic_create_course', error)
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/courses/${data}/manage`))
}

export async function updateCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const courseId = uuid.safeParse(formData.get('courseId'))
  if (!courseId.success) return errorState('invalid')
  const parsed = courseSchema.safeParse(formValues(formData, ['code', 'title', 'titleAr', 'description', 'term', 'departmentId', 'status'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('academic_update_course', {
    p_course: courseId.data,
    p_code: parsed.data.code,
    p_title: parsed.data.title,
    p_title_ar: parsed.data.titleAr,
    p_description: parsed.data.description,
    p_department: parsed.data.departmentId,
    p_term: parsed.data.term,
    p_status: parsed.data.status,
  })
  if (error) return error.code === '23505' ? errorState('invalid', { code: 'courseCodeTaken' }) : dbFailure('academic_update_course', error)
  refresh()
  return successState()
}

export async function updateCourseAi(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = courseAiSchema.safeParse(
    formValues(formData, ['courseId', 'aiEnabled', 'allowSummaries', 'allowQuizzes', 'allowFlashcards', 'allowStudyPlans', 'instructions'] as const),
  )
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('academic_update_course_ai', {
    p_course: parsed.data.courseId,
    p_ai_enabled: parsed.data.aiEnabled,
    p_summaries: parsed.data.allowSummaries,
    p_quizzes: parsed.data.allowQuizzes,
    p_flashcards: parsed.data.allowFlashcards,
    p_study_plans: parsed.data.allowStudyPlans,
    p_instructions: parsed.data.instructions,
  })
  if (error) return dbFailure('academic_update_course_ai', error)
  refresh()
  return successState()
}

export async function setCourseJoin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const courseId = uuid.safeParse(formData.get('courseId'))
  if (!courseId.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('academic_set_join', {
    p_course: courseId.data,
    p_open: formData.get('open') === 'true',
    p_rotate: formData.get('rotate') === 'true',
  })
  if (error) return dbFailure('academic_set_join', error)
  refresh()
  return successState()
}

export async function addInstructor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = instructorSchema.safeParse(formValues(formData, ['courseId', 'email'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('invite', ctx.user.id)) return errorState('rateLimited')
  const { error } = await ctx.supabase.rpc('academic_add_instructor', { p_course: parsed.data.courseId, p_email: parsed.data.email })
  if (error) return error.code === 'P0002' ? errorState('notFound') : dbFailure('academic_add_instructor', error)
  refresh()
  return successState()
}

export async function removeCourseMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const courseId = uuid.safeParse(formData.get('courseId'))
  const userId = uuid.safeParse(formData.get('userId'))
  if (!courseId.success || !userId.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('academic_remove_member', { p_course: courseId.data, p_user: userId.data })
  if (error) return dbFailure('academic_remove_member', error)
  if (userId.data === ctx.user.id) {
    const slug = slugField.safeParse(formData.get('tenant'))
    if (slug.success) redirect(localizedPath(readLocale(formData), `/app/${slug.data}/courses`))
  }
  refresh()
  return successState()
}

export async function joinCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = joinSchema.safeParse(formValues(formData, ['code'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('join', ctx.user.id)) return errorState('rateLimited')
  const { data, error } = await ctx.supabase.rpc('academic_join_course', { p_tenant_slug: slug.data, p_code: parsed.data.code })
  if (error) return error.code === '54000' ? errorState('joinLimit') : dbFailure('academic_join_course', error)
  const r = data as { status: 'joined' | 'already' | 'invalid'; course_id?: string }
  if (r.status === 'invalid' || !r.course_id) return errorState('invalid', { code: 'joinCode' })
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/courses/${r.course_id}`))
}

const STUDY_ERRORS: Record<StudyAidError, ActionErrorKey> = {
  notConfigured: 'notConfigured',
  aiBudget: 'studyBudget',
  dailyLimit: 'dailyLimit',
  forbidden: 'forbidden',
  toolOff: 'studyToolsOff',
  invalid: 'invalid',
  aiRefused: 'studyRefused',
  generic: 'generic',
}

/** Generate a study aid from the chosen materials, then open it. */
export async function generateStudyAidAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = generateSchema.safeParse({
    ...formValues(formData, ['courseId', 'kind', 'count', 'examDate', 'perWeek', 'minutes', 'language'] as const),
    documentIds: formData.getAll('documentIds').map(String),
  })
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('study', ctx.user.id)) return errorState('rateLimited')

  // Study plans start from the university's "today".
  const tenant = await ctx.supabase.from('tenants').select('timezone').eq('slug', slug.data).maybeSingle()
  const timeZone = tenant.data?.timezone ?? 'UTC'
  let today: string
  try {
    today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    today = new Date().toISOString().slice(0, 10)
  }

  const locale = readLocale(formData)
  const result = await generateStudyAid({
    supabase: ctx.supabase,
    courseId: parsed.data.courseId,
    kind: parsed.data.kind,
    documentIds: parsed.data.documentIds,
    count: parsed.data.count,
    examDate: parsed.data.examDate,
    perWeek: parsed.data.perWeek,
    minutes: parsed.data.minutes,
    language: parsed.data.language,
    today,
    fallbackTitle: String(formData.get('fallbackTitle') ?? '').slice(0, 200) || parsed.data.kind,
  })
  if (!result.ok) return errorState(STUDY_ERRORS[result.error])
  redirect(localizedPath(locale, `/app/${slug.data}/courses/${parsed.data.courseId}/study/${result.itemId}`))
}

/** Grade a quiz attempt (called from the quiz component). */
export async function submitQuiz(input: { itemId: string; answers: (number | null)[] }): Promise<ActionState<QuizResultT>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const itemId = uuid.safeParse(input.itemId)
  const answers = z.array(z.number().int().min(0).max(3).nullable()).max(60).safeParse(input.answers)
  if (!itemId.success || !answers.success) return errorState('invalid')
  const { data, error } = await ctx.supabase.rpc('academic_submit_quiz', { p_item: itemId.data, p_answers: answers.data as Json })
  if (error) return dbFailure('academic_submit_quiz', error)
  const parsed = QuizResult.safeParse(data)
  if (!parsed.success) {
    log.error('academic.quiz_payload_invalid')
    return errorState('generic')
  }
  return successState(parsed.data)
}

/** Save progress on flashcards ({known}) or a study plan ({done}). */
export async function saveStudyProgress(input: { itemId: string; key: 'known' | 'done'; indexes: number[] }): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const itemId = uuid.safeParse(input.itemId)
  const indexes = z.array(z.number().int().min(0).max(59)).max(60).safeParse(input.indexes)
  if (!itemId.success || !indexes.success || (input.key !== 'known' && input.key !== 'done')) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('academic_update_progress', { p_item: itemId.data, p_state: { [input.key]: [...new Set(indexes.data)] } })
  if (error) return dbFailure('academic_update_progress', error)
  return successState()
}

export async function deleteStudyItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const itemId = uuid.safeParse(formData.get('itemId'))
  const courseId = uuid.safeParse(formData.get('courseId'))
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!itemId.success || !courseId.success || !slug.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('academic_delete_item', { p_item: itemId.data })
  if (error) return dbFailure('academic_delete_item', error)
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/courses/${courseId.data}`))
}

export async function setMaterialPublished(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const documentId = uuid.safeParse(formData.get('documentId'))
  if (!documentId.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('academic_set_material_published', { p_document: documentId.data, p_published: formData.get('published') === 'true' })
  if (error) return dbFailure('academic_set_material_published', error)
  refresh()
  return successState()
}

/** Remove a course material: its files first (allowed while the document exists), then the rows. */
export async function deleteCourseMaterial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const documentId = uuid.safeParse(formData.get('documentId'))
  if (!documentId.success) return errorState('invalid')
  const versions = await ctx.supabase.from('knowledge_document_versions').select('storage_path').eq('document_id', documentId.data)
  if (versions.error) return dbFailure('course_material_versions', versions.error)
  const paths = (versions.data ?? []).map((v) => v.storage_path)
  if (paths.length) {
    const removed = await ctx.supabase.storage.from('tenant-documents').remove(paths)
    if (removed.error) {
      log.error('academic.material_files_remove_failed', { message: removed.error.message })
      return errorState('generic')
    }
  }
  const { error } = await ctx.supabase.rpc('knowledge_delete_document', { p_document: documentId.data })
  if (error) return dbFailure('knowledge_delete_document', error)
  refresh()
  return successState()
}

export async function updateAcademicSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = academicSettingsSchema.safeParse(formValues(formData, ['monthlyBudget', 'dailyLimit'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('academic_update_settings', {
    p_tenant_slug: slug.data,
    p_monthly_budget_usd: parsed.data.monthlyBudget,
    p_daily_limit: parsed.data.dailyLimit,
  })
  if (error) return dbFailure('academic_update_settings', error)
  refresh()
  return successState()
}
