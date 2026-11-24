'use server'

import { refresh } from 'next/cache'
import { toFieldErrors } from '@/lib/auth/schemas'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import { voiceSettingsSchema, voiceUsageSchema } from './schemas'

/** Voice Server Actions. The voice_* functions authorize every call again. */

export async function updateVoiceSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = voiceSettingsSchema.safeParse(
    formValues(formData, ['enabled', 'inputEnabled', 'outputEnabled', 'provider', 'inputPrice', 'outputPrice', 'monthlyBudget', 'dailyMinutes'] as const),
  )
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const v = parsed.data
  const { error } = await ctx.supabase.rpc('voice_update_settings', {
    p_tenant_slug: slug.data,
    p_enabled: v.enabled,
    p_input_enabled: v.inputEnabled,
    p_output_enabled: v.outputEnabled,
    p_provider: v.provider,
    p_input_price_per_minute: v.inputPrice,
    p_output_price_per_1k_chars: v.outputPrice,
    p_monthly_budget_usd: v.monthlyBudget,
    p_daily_input_seconds: v.dailyMinutes * 60,
  })
  if (error) return dbFailure('voice_update_settings', error)
  refresh()
  return successState()
}

/** Usage of the browser's own speech features (seconds of dictation, characters read aloud). */
export async function recordVoiceUsage(input: { tenant: string; surface: string; kind: string; seconds?: number; characters?: number }): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = voiceUsageSchema.safeParse(input)
  if (!parsed.success) return errorState('invalid')
  if (await isRateLimited('voice', ctx.user.id)) return errorState('rateLimited')
  const v = parsed.data
  const { error } = await ctx.supabase.rpc('voice_record', {
    p_tenant_slug: v.tenant,
    p_surface: v.surface,
    p_kind: v.kind,
    p_provider: 'browser',
    p_seconds: Math.round(v.seconds * 100) / 100,
    p_characters: v.characters,
  })
  if (error) return dbFailure('voice_record', error)
  return successState()
}
