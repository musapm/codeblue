'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import { leadUpdateSchema, manualLeadSchema, PROGRAM_STATUSES, programSchema, toProgramRow } from './schemas'

/**
 * Staff admissions Server Actions. Programs are written directly (RLS: programs.manage +
 * feature); everything else goes through the admissions_* functions, which authorize again.
 */

const uuid = z.uuid()

const PROGRAM_FIELDS = [
  'code', 'name', 'nameAr', 'level', 'departmentId', 'description', 'descriptionAr', 'requirements', 'requirementsAr',
  'durationMonths', 'studyMode', 'teachingLanguage', 'intakes', 'intakesAr', 'tuitionAmount', 'tuitionCurrency',
  'tuitionPeriod', 'tuitionNote', 'tuitionNoteAr', 'applicationDeadline', 'applicationUrl', 'sortOrder',
] as const

export async function saveProgram(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const slug = slugField.safeParse(formData.get('tenant'))
  const programId = formData.get('programId') ? uuid.safeParse(formData.get('programId')) : null
  if (!slug.success || (programId && !programId.success)) return errorState('invalid')
  const parsed = programSchema.safeParse(formValues(formData, PROGRAM_FIELDS))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const row = toProgramRow(parsed.data)

  if (programId) {
    const { data, error } = await ctx.supabase.from('admission_programs').update(row).eq('id', programId.data!).select('id')
    if (error) return dbFailure('admission_program_update', error)
    if (!data?.length) return errorState('forbidden')
    refresh()
    return successState()
  }
  const tenant = await ctx.supabase.from('tenants').select('id').eq('slug', slug.data).maybeSingle()
  if (tenant.error) return dbFailure('tenant_lookup', tenant.error)
  if (!tenant.data) return errorState('forbidden')
  const status = PROGRAM_STATUSES.includes(formData.get('status') as never) ? String(formData.get('status')) : 'draft'
  const { data, error } = await ctx.supabase.from('admission_programs').insert({ ...row, tenant_id: tenant.data.id, status }).select('id').single()
  if (error) return dbFailure('admission_program_insert', error)
  redirect(localizedPath(locale, `/app/${slug.data}/admissions/programs/${data.id}`))
}

export async function setProgramStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const programId = uuid.safeParse(formData.get('programId'))
  const status = z.enum(PROGRAM_STATUSES).safeParse(formData.get('status'))
  if (!programId.success || !status.success) return errorState('invalid')
  const { data, error } = await ctx.supabase.from('admission_programs').update({ status: status.data }).eq('id', programId.data).select('id')
  if (error) return dbFailure('admission_program_status', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

export async function deleteProgram(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const programId = uuid.safeParse(formData.get('programId'))
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!programId.success || !slug.success) return errorState('invalid')
  const { data, error } = await ctx.supabase.from('admission_programs').delete().eq('id', programId.data).select('id')
  // A program referenced by inquiries cannot be deleted (foreign key): archive it instead.
  if (error) return error.code === '23503' ? errorState('inUse') : dbFailure('admission_program_delete', error)
  if (!data?.length) return errorState('forbidden')
  redirect(localizedPath(locale, `/app/${slug.data}/admissions/programs`))
}

const settingsSchema = z.object({
  contactEmail: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.email({ error: 'emailInvalid' }).max(254, { error: 'emailInvalid' }).nullable()),
  privacyUrl: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.url({ protocol: /^https$/, error: 'urlInvalid' }).max(500, { error: 'urlInvalid' }).nullable()),
  welcome: z.string().trim().max(500, { error: 'nameTooLong' }).optional(),
  welcomeAr: z.string().trim().max(500, { error: 'nameTooLong' }).optional(),
  consentText: z
    .string()
    .trim()
    .max(1000, { error: 'nameTooLong' })
    .optional()
    .refine((v) => !v || v.length >= 20, { error: 'messageTooShort' }),
  consentTextAr: z
    .string()
    .trim()
    .max(1000, { error: 'nameTooLong' })
    .optional()
    .refine((v) => !v || v.length >= 20, { error: 'messageTooShort' }),
})

export async function updateAdmissionsSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = settingsSchema.safeParse(formValues(formData, ['contactEmail', 'privacyUrl', 'welcome', 'welcomeAr', 'consentText', 'consentTextAr'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const v = parsed.data
  const { error } = await ctx.supabase.rpc('admissions_update_settings', {
    p_tenant_slug: slug.data,
    p_public_enabled: formData.get('publicEnabled') === 'on',
    p_contact_email: v.contactEmail,
    p_privacy_url: v.privacyUrl,
    p_welcome: v.welcome || null,
    p_welcome_ar: v.welcomeAr || null,
    p_consent_text: v.consentText || null,
    p_consent_text_ar: v.consentTextAr || null,
  })
  if (error) return dbFailure('admissions_update_settings', error)
  refresh()
  return successState()
}

const assistantSchema = z.object({
  instructions: z.string().trim().max(2000, { error: 'nameTooLong' }).optional(),
  monthlyBudgetUsd: z.coerce.number({ error: 'budgetInvalid' }).min(0, { error: 'budgetInvalid' }).max(100_000, { error: 'budgetInvalid' }),
  dailyQuestions: z.coerce.number({ error: 'numberInvalid' }).int({ error: 'numberInvalid' }).min(1, { error: 'numberInvalid' }).max(200, { error: 'numberInvalid' }),
})

export async function updateAdmissionsAssistant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = assistantSchema.safeParse(formValues(formData, ['instructions', 'monthlyBudgetUsd', 'dailyQuestions'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('admissions_update_assistant', {
    p_tenant_slug: slug.data,
    p_enabled: formData.get('assistantEnabled') === 'on',
    p_instructions: parsed.data.instructions || null,
    p_monthly_budget_usd: Math.round(parsed.data.monthlyBudgetUsd * 100) / 100,
    p_daily_questions: parsed.data.dailyQuestions,
  })
  if (error) return dbFailure('admissions_update_assistant', error)
  refresh()
  return successState()
}

export async function createLead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = manualLeadSchema.safeParse(
    formValues(formData, ['fullName', 'email', 'phone', 'country', 'programId', 'intake', 'message', 'locale', 'consentNote'] as const),
  )
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('lead', ctx.user.id)) return errorState('rateLimited')
  const v = parsed.data
  const { data, error } = await ctx.supabase.rpc('admissions_create_lead', {
    p_tenant_slug: slug.data,
    p_full_name: v.fullName,
    p_email: v.email,
    p_phone: v.phone,
    p_country: v.country,
    p_program: v.programId,
    p_intake: v.intake,
    p_message: v.message,
    p_locale: v.locale,
    p_consent_note: v.consentNote,
  })
  if (error) return dbFailure('admissions_create_lead', error)
  const id = (data as { id?: string } | null)?.id
  redirect(localizedPath(locale, `/app/${slug.data}/admissions${id ? `/leads/${id}` : ''}`))
}

export async function updateLead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = leadUpdateSchema.safeParse(formValues(formData, ['leadId', 'stage', 'lostReason', 'assignedTo', 'programId'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const v = parsed.data
  const { error } = await ctx.supabase.rpc('admissions_update_lead', {
    p_lead: v.leadId,
    p_stage: v.stage,
    p_lost_reason: v.lostReason,
    p_assigned_to: v.assignedTo,
    p_program: v.programId,
  })
  if (error) return dbFailure('admissions_update_lead', error)
  refresh()
  return successState()
}

export async function addLeadNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const leadId = uuid.safeParse(formData.get('leadId'))
  const body = z.string().trim().min(1, { error: 'messageTooShort' }).max(4000, { error: 'messageTooLong' }).safeParse(formData.get('body'))
  if (!leadId.success) return errorState('invalid')
  if (!body.success) return errorState('invalid', { body: 'messageTooShort' })
  const { error } = await ctx.supabase.rpc('admissions_add_note', { p_lead: leadId.data, p_body: body.data })
  if (error) return dbFailure('admissions_add_note', error)
  refresh()
  return successState()
}

export async function deleteLead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const leadId = uuid.safeParse(formData.get('leadId'))
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!leadId.success || !slug.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('admissions_delete_lead', { p_lead: leadId.data })
  if (error) return dbFailure('admissions_delete_lead', error)
  redirect(localizedPath(locale, `/app/${slug.data}/admissions`))
}
