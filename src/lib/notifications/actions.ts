'use server'

import { beginAction, dbFailure, isActionContext } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { preferenceSchema } from './schemas'

/** Save one notification choice for the signed-in person. */
export async function setPreferenceAction(input: { tenant: string; kind: string; inApp: boolean; email: boolean }): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = preferenceSchema.safeParse(input)
  if (!parsed.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('set_notification_preference', {
    p_tenant_slug: parsed.data.tenant,
    p_kind: parsed.data.kind,
    p_in_app: parsed.data.inApp,
    p_email: parsed.data.email,
  })
  if (error) return dbFailure('set_notification_preference', error)
  return successState()
}
