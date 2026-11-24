'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import type { Json } from '@/lib/supabase/database.types'
import { integrationSchema } from './schemas'

const uuid = z.uuid()

export async function saveIntegrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const id = formData.get('integrationId') ? uuid.safeParse(formData.get('integrationId')) : null
  if (!slug.success || (id && !id.success)) return errorState('invalid')
  const parsed = integrationSchema.safeParse(formValues(formData, ['kind', 'name', 'config', 'secretRef'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { data, error } = await ctx.supabase.rpc('integration_save', {
    p_tenant_slug: slug.data,
    p_integration: id?.data ?? null,
    p_kind: parsed.data.kind,
    p_name: parsed.data.name,
    p_config: parsed.data.config as Json,
    p_secret_ref: parsed.data.secretRef,
  })
  if (error) return dbFailure('integration_save', error)
  if (!id) redirect(localizedPath(readLocale(formData), `/app/${slug.data}/integrations/${data}`))
  refresh()
  return successState()
}

export async function setIntegrationStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = uuid.safeParse(formData.get('integrationId'))
  const status = z.enum(['draft', 'active', 'paused']).safeParse(formData.get('status'))
  if (!id.success || !status.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('integration_set_status', { p_integration: id.data, p_status: status.data })
  if (error) return dbFailure('integration_set_status', error)
  refresh()
  return successState()
}

export async function deleteIntegrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const id = uuid.safeParse(formData.get('integrationId'))
  if (!slug.success || !id.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('integration_delete', { p_integration: id.data })
  if (error) return dbFailure('integration_delete', error)
  redirect(localizedPath(readLocale(formData), `/app/${slug.data}/integrations`))
}
