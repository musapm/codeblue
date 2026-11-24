'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionErrorKey, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import { draftDocument, ticketDigest, type StaffAiError } from './ai'
import { digestSchema, draftSchema, staffSettingsSchema, type Digest } from './schemas'

/** Staff assistant Server Actions. The staff_* functions and RLS authorize every call again. */

const STAFF_ERRORS: Record<StaffAiError, ActionErrorKey> = {
  notConfigured: 'aiNotConfigured',
  disabled: 'staffOff',
  aiBudget: 'aiBudget',
  dailyLimit: 'dailyLimit',
  forbidden: 'forbidden',
  invalid: 'invalid',
  aiRefused: 'aiRefused',
  generic: 'generic',
}

/** Write a draft with AI, save it privately, then open it. */
export async function createDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = draftSchema.safeParse(formValues(formData, ['kind', 'audience', 'purpose', 'tone', 'language', 'departmentId', 'useDocuments'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('staff', ctx.user.id)) return errorState('rateLimited')

  const result = await draftDocument({
    supabase: ctx.supabase,
    slug: slug.data,
    ...parsed.data,
    fallbackTitle: String(formData.get('fallbackTitle') ?? '').slice(0, 200) || parsed.data.kind,
  })
  if (!result.ok) return errorState(STAFF_ERRORS[result.error])
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/staff-assistant/drafts/${result.draftId}`))
}

export async function deleteDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const draftId = z.uuid().safeParse(formData.get('draftId'))
  if (!slug.success || !draftId.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('staff_delete_draft', { p_draft: draftId.data })
  if (error) return dbFailure('staff_delete_draft', error)
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/staff-assistant/drafts`))
}

export type DigestResult = { digest: Digest | null; total: number; covered: number }

/** An AI digest of the open tickets in one view. Shown once, not stored. */
export async function generateDigestAction(_prev: ActionState<DigestResult>, formData: FormData): Promise<ActionState<DigestResult>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = digestSchema.safeParse(formValues(formData, ['scope', 'departmentId', 'language'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('staff', ctx.user.id)) return errorState('rateLimited')

  const result = await ticketDigest({ supabase: ctx.supabase, slug: slug.data, ...parsed.data })
  if (!result.ok) return errorState(STAFF_ERRORS[result.error])
  return successState({ digest: result.digest, total: result.total, covered: result.covered })
}

export async function updateStaffSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = staffSettingsSchema.safeParse(formValues(formData, ['enabled', 'instructions', 'monthlyBudget', 'dailyLimit'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('staff_assistant_update_settings', {
    p_tenant_slug: slug.data,
    p_enabled: parsed.data.enabled,
    p_instructions: parsed.data.instructions,
    p_monthly_budget_usd: parsed.data.monthlyBudget,
    p_daily_limit: parsed.data.dailyLimit,
  })
  if (error) return dbFailure('staff_assistant_update_settings', error)
  refresh()
  return successState()
}
