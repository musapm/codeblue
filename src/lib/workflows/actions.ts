'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionErrorKey, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import type { Json } from '@/lib/supabase/database.types'
import { suggestRequest, type SuggestError, type Suggestion } from './ai'
import { listPublishedForms, toCatalog } from './queries'
import { commentSchema, definitionSchema, parseFieldsJson, statusUpdateSchema, suggestSchema, versionSchema, workflowSettingsSchema } from './schemas'

/** Service request Server Actions. The workflow_* functions and RLS authorize every call again. */

const uuid = z.uuid()

// ---------------------------------------------------------------------------
// Forms (managers)
// ---------------------------------------------------------------------------

export async function saveDefinitionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const id = formData.get('definitionId') ? uuid.safeParse(formData.get('definitionId')) : null
  if (!slug.success || (id && !id.success)) return errorState('invalid')
  const parsed = definitionSchema.safeParse(formValues(formData, ['key', 'title', 'titleAr', 'description', 'descriptionAr', 'departmentId'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const v = parsed.data
  const { data, error } = await ctx.supabase.rpc('workflow_save_definition', {
    p_tenant_slug: slug.data,
    p_definition: id?.data ?? null,
    p_key: v.key,
    p_title: v.title,
    p_title_ar: v.titleAr,
    p_description: v.description,
    p_description_ar: v.descriptionAr,
    p_department: v.departmentId,
  })
  if (error) return error.code === '23505' ? errorState('invalid', { key: 'workflowKeyTaken' }) : dbFailure('workflow_save_definition', error)
  if (!id) redirect(localizedPath(readLocale(formData), `/app/${slug.data}/workflows/forms/${data}`))
  refresh()
  return successState()
}

export async function saveDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = uuid.safeParse(formData.get('definitionId'))
  if (!id.success) return errorState('invalid')
  const parsed = versionSchema.safeParse(formValues(formData, ['fields', 'instructions', 'instructionsAr', 'confirmation', 'confirmationAr'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const fields = parseFieldsJson(parsed.data.fields)
  if (!fields) return errorState('invalid', { fields: 'workflowFields' })
  const { error } = await ctx.supabase.rpc('workflow_save_draft', {
    p_definition: id.data,
    p_fields: fields as unknown as Json,
    p_instructions: parsed.data.instructions,
    p_instructions_ar: parsed.data.instructionsAr,
    p_confirmation: parsed.data.confirmation,
    p_confirmation_ar: parsed.data.confirmationAr,
  })
  if (error) return error.code === '22023' ? errorState('invalid', { fields: 'workflowFields' }) : dbFailure('workflow_save_draft', error)
  refresh()
  return successState()
}

async function definitionOp(formData: FormData, op: 'publish' | 'discard' | 'archive' | 'activate'): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = uuid.safeParse(formData.get('definitionId'))
  if (!id.success) return errorState('invalid')
  const { error } =
    op === 'publish'
      ? await ctx.supabase.rpc('workflow_publish', { p_definition: id.data })
      : op === 'discard'
        ? await ctx.supabase.rpc('workflow_discard_draft', { p_definition: id.data })
        : await ctx.supabase.rpc('workflow_set_status', { p_definition: id.data, p_status: op === 'archive' ? 'archived' : 'active' })
  if (error) return dbFailure(`workflow_${op}`, error)
  refresh()
  return successState()
}

export async function publishDraftAction(_prev: ActionState, formData: FormData) {
  return definitionOp(formData, 'publish')
}
export async function discardDraftAction(_prev: ActionState, formData: FormData) {
  return definitionOp(formData, 'discard')
}
export async function archiveFormAction(_prev: ActionState, formData: FormData) {
  return definitionOp(formData, 'archive')
}
export async function activateFormAction(_prev: ActionState, formData: FormData) {
  return definitionOp(formData, 'activate')
}

export async function deleteFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const id = uuid.safeParse(formData.get('definitionId'))
  if (!slug.success || !id.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('workflow_delete_definition', { p_definition: id.data })
  if (error) return error.code === '23503' ? errorState('inUse') : dbFailure('workflow_delete_definition', error)
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/workflows/forms`))
}

export async function updateWorkflowSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = workflowSettingsSchema.safeParse(formValues(formData, ['aiEnabled', 'monthlyBudget', 'dailyLimit'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('workflow_update_settings', {
    p_tenant_slug: slug.data,
    p_ai_enabled: parsed.data.aiEnabled,
    p_monthly_budget_usd: parsed.data.monthlyBudget,
    p_daily_limit: parsed.data.dailyLimit,
  })
  if (error) return dbFailure('workflow_update_settings', error)
  refresh()
  return successState()
}

// ---------------------------------------------------------------------------
// Requesters
// ---------------------------------------------------------------------------

/** Submit after the review step. The answers come as JSON from the form; the database checks them. */
export async function submitRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const definitionId = uuid.safeParse(formData.get('definitionId'))
  const versionId = uuid.safeParse(formData.get('versionId'))
  const source = formData.get('source') === 'assistant' ? 'assistant' : 'form'
  let answers: unknown
  try {
    answers = JSON.parse(String(formData.get('answers') ?? ''))
  } catch {
    return errorState('invalid')
  }
  if (!slug.success || !definitionId.success || !versionId.success || typeof answers !== 'object' || answers === null || Array.isArray(answers)) return errorState('invalid')
  if (await isRateLimited('workflow', ctx.user.id)) return errorState('rateLimited')
  const { data, error } = await ctx.supabase.rpc('workflow_submit', {
    p_tenant_slug: slug.data,
    p_definition: definitionId.data,
    p_version: versionId.data,
    p_answers: answers as Json,
    p_source: source,
  })
  if (error) return error.code === '40001' ? errorState('formChanged') : dbFailure('workflow_submit', error)
  const id = (data as { id?: string } | null)?.id
  if (!id) return errorState('generic')
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/services/${id}?submitted=1`))
}

const SUGGEST_ERRORS: Record<SuggestError, ActionErrorKey> = {
  notConfigured: 'aiNotConfigured',
  disabled: 'suggestionsOff',
  aiBudget: 'aiBudget',
  dailyLimit: 'dailyLimit',
  forbidden: 'forbidden',
  invalid: 'invalid',
  aiRefused: 'aiRefused',
  generic: 'generic',
}

/** The workflow agent: pick and pre-fill a form from a description. Nothing is submitted. */
export async function suggestFormAction(_prev: ActionState<Suggestion>, formData: FormData): Promise<ActionState<Suggestion>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = suggestSchema.safeParse(formValues(formData, ['text'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('workflow', ctx.user.id)) return errorState('rateLimited')
  const tenant = await ctx.supabase.from('tenants').select('id, timezone').eq('slug', slug.data).maybeSingle()
  if (!tenant.data) return errorState('notFound')
  let today: string
  try {
    today = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.data.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    today = new Date().toISOString().slice(0, 10)
  }
  const forms = toCatalog(await listPublishedForms(tenant.data.id), readLocale(formData))
  const result = await suggestRequest({ supabase: ctx.supabase, slug: slug.data, text: parsed.data.text, forms, today })
  if (!result.ok) return errorState(SUGGEST_ERRORS[result.error])
  return successState(result.suggestion)
}

export async function cancelRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = uuid.safeParse(formData.get('requestId'))
  if (!id.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('workflow_cancel', { p_request: id.data })
  if (error) return dbFailure('workflow_cancel', error)
  refresh()
  return successState()
}

export async function commentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = commentSchema.safeParse(formValues(formData, ['requestId', 'body', 'internal'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('workflow', ctx.user.id)) return errorState('rateLimited')
  const { error } = await ctx.supabase.rpc('workflow_comment', { p_request: parsed.data.requestId, p_body: parsed.data.body, p_internal: parsed.data.internal })
  if (error) return dbFailure('workflow_comment', error)
  refresh()
  return successState()
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

export async function updateStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = statusUpdateSchema.safeParse(formValues(formData, ['requestId', 'status', 'message'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('workflow_update_status', { p_request: parsed.data.requestId, p_status: parsed.data.status, p_message: parsed.data.message })
  if (error) return dbFailure('workflow_update_status', error)
  refresh()
  return successState()
}

/** assignee: a user id, 'me', or '' to unassign. */
export async function assignRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = uuid.safeParse(formData.get('requestId'))
  const raw = String(formData.get('assignee') ?? '')
  const assignee = raw === 'me' ? ctx.user.id : raw === '' ? null : uuid.safeParse(raw).success ? raw : undefined
  if (!id.success || assignee === undefined) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('workflow_assign', { p_request: id.data, p_assignee: assignee })
  if (error) return dbFailure('workflow_assign', error)
  refresh()
  return successState()
}
