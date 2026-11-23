'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { beginAction, dbFailure, formValues, isActionContext } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import { reviewSchema } from './schemas'

/** AI quality Server Actions. quality_review_* authorize every call again (quality.review). */

export async function saveQualityReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const parsed = reviewSchema.safeParse(formValues(formData, ['messageIds', 'outcome', 'note'] as const))
  if (!slug.success) return errorState('invalid')
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('quality_review_save', {
    p_tenant_slug: slug.data,
    p_messages: parsed.data.messageIds,
    p_outcome: parsed.data.outcome,
    p_note: parsed.data.note,
  })
  if (error) return dbFailure('quality_review_save', error)
  refresh()
  return successState()
}

const reopenSchema = z.object({
  messageIds: reviewSchema.shape.messageIds,
})

export async function reopenQualityReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const parsed = reopenSchema.safeParse(formValues(formData, ['messageIds'] as const))
  if (!slug.success || !parsed.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('quality_review_reopen', { p_tenant_slug: slug.data, p_messages: parsed.data.messageIds })
  if (error) return dbFailure('quality_review_reopen', error)
  refresh()
  return successState()
}
