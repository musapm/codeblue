'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { beginAction, dbFailure, formValues, isActionContext, log } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'

/** Assistant Server Actions. The database authorizes each one again (assistant_* functions, RLS). */

const settingsSchema = z.object({
  enabled: z.boolean(),
  instructions: z.string().trim().max(2000, { error: 'nameTooLong' }).optional(),
  monthlyBudgetUsd: z.coerce.number({ error: 'budgetInvalid' }).min(0, { error: 'budgetInvalid' }).max(100_000, { error: 'budgetInvalid' }),
})

export async function updateAssistantSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const v = formValues(formData, ['instructions', 'monthlyBudgetUsd'] as const)
  const parsed = settingsSchema.safeParse({ ...v, enabled: formData.get('enabled') === 'on' })
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('assistant_update_settings', {
    p_tenant_slug: slug.data,
    p_enabled: parsed.data.enabled,
    p_instructions: parsed.data.instructions || null,
    p_monthly_budget_usd: Math.round(parsed.data.monthlyBudgetUsd * 100) / 100,
  })
  if (error) return dbFailure('assistant_update_settings', error)
  refresh()
  return successState()
}

const feedbackSchema = z.object({
  messageId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(1000).optional(),
})

export async function setAssistantFeedback(input: { messageId: string; rating: 1 | -1; comment?: string }): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = feedbackSchema.safeParse(input)
  if (!parsed.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('assistant_set_feedback', {
    p_message: parsed.data.messageId,
    p_rating: parsed.data.rating,
    p_comment: parsed.data.comment || null,
  })
  if (error) return dbFailure('assistant_set_feedback', error)
  return successState()
}

/**
 * A short-lived link to the current file of a cited document. Created with the student's own
 * session: Storage only signs files whose document they may read (app.can_read_knowledge).
 */
export async function openKnowledgeSource(input: { documentId: string }): Promise<ActionState<{ url: string; isPdf: boolean }>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const documentId = z.uuid().safeParse(input.documentId)
  if (!documentId.success) return errorState('invalid')
  const doc = await ctx.supabase.from('knowledge_documents').select('current_version_id').eq('id', documentId.data).maybeSingle()
  if (doc.error) return dbFailure('knowledge_source_document', doc.error)
  if (!doc.data?.current_version_id) return errorState('notFound')
  const version = await ctx.supabase.from('knowledge_document_versions').select('storage_path, mime_type').eq('id', doc.data.current_version_id).maybeSingle()
  if (version.error) return dbFailure('knowledge_source_version', version.error)
  if (!version.data) return errorState('notFound')
  const signed = await ctx.supabase.storage.from('tenant-documents').createSignedUrl(version.data.storage_path, 300)
  if (signed.error || !signed.data) {
    log.warn('assistant.source_link_failed', { message: signed.error?.message })
    return errorState('notFound')
  }
  return successState({ url: signed.data.signedUrl, isPdf: version.data.mime_type === 'application/pdf' })
}
