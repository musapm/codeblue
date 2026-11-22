'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { publicEnv } from '@/lib/env/public'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, readLocale } from './action-helpers'
import { errorState, successState, type ActionState } from './action-state'
import { createTenantSchema, supportGrantSchema, tenantFeatureSchema, tenantStatusSchema } from './schemas'

/**
 * Platform console actions. The database restricts all of them to platform owners and
 * admins (create_tenant, tenants/tenant_features/support_access_grants policies); this
 * file only validates input and reports results.
 */

export type CreateTenantResult = { slug: string; ownerInviteLink?: string; ownerEmail?: string }

export async function createTenant(_prev: ActionState<CreateTenantResult>, formData: FormData): Promise<ActionState<CreateTenantResult>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const parsed = createTenantSchema.safeParse(formValues(formData, ['name', 'nameAr', 'slug', 'defaultLocale', 'timezone', 'isDemo', 'ownerEmail'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('tenant', ctx.user.id)) return errorState('rateLimited')
  const { name, nameAr, slug, defaultLocale, timezone, isDemo, ownerEmail } = parsed.data

  const created = await ctx.supabase.rpc('create_tenant', {
    p_slug: slug,
    p_name: name,
    p_default_locale: defaultLocale,
    p_timezone: timezone,
    p_is_demo: isDemo,
  })
  if (created.error) return created.error.code === '23505' ? errorState('conflict', { slug: 'slugTaken' }) : dbFailure('create_tenant', created.error)

  const named = await ctx.supabase
    .from('tenants')
    .update({ name_translations: nameAr ? { en: name, ar: nameAr } : { en: name } })
    .eq('slug', slug)
    .select('id')
  if (named.error) return dbFailure('tenant_names', named.error)

  let ownerInviteLink: string | undefined
  if (ownerEmail) {
    const inv = await ctx.supabase.rpc('create_invitation', { p_tenant_slug: slug, p_email: ownerEmail, p_role_key: 'university_owner', p_valid_days: 14 })
    if (inv.error) return dbFailure('owner_invitation', inv.error)
    const token = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(inv.data)
    if (token.success) ownerInviteLink = `${publicEnv.siteUrl}${localizedPath(locale, `/invite/${token.data.token}`)}`
  }
  refresh()
  return successState({ slug, ownerInviteLink, ownerEmail })
}

export async function setTenantStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = tenantStatusSchema.safeParse(formValues(formData, ['slug', 'status'] as const))
  if (!parsed.success) return errorState('invalid')
  const { slug, status } = parsed.data

  const { data, error } = await ctx.supabase
    .from('tenants')
    .update({ status, archived_at: status === 'archived' ? new Date().toISOString() : null })
    .eq('slug', slug)
    .select('id')
  if (error) return dbFailure('tenant_status', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

export async function setTenantFeature(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = tenantFeatureSchema.safeParse(formValues(formData, ['slug', 'featureKey', 'enabled'] as const))
  const tenantId = z.uuid().safeParse(formData.get('tenantId'))
  if (!parsed.success || !tenantId.success) return errorState('invalid')

  const { data, error } = await ctx.supabase
    .from('tenant_features')
    .upsert({ tenant_id: tenantId.data, feature_key: parsed.data.featureKey, enabled: parsed.data.enabled }, { onConflict: 'tenant_id,feature_key' })
    .select('feature_key')
  if (error) return dbFailure('tenant_feature', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

export async function grantSupportAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = supportGrantSchema.safeParse(formValues(formData, ['slug', 'granteeId', 'reason', 'hours'] as const))
  const tenantId = z.uuid().safeParse(formData.get('tenantId'))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (!tenantId.success) return errorState('invalid')

  // Both ends set here so the 24-hour window constraint holds exactly.
  const startsAt = new Date()
  const expiresAt = new Date(startsAt.getTime() + parsed.data.hours * 3_600_000)
  const { error } = await ctx.supabase.from('support_access_grants').insert({
    tenant_id: tenantId.data,
    grantee_id: parsed.data.granteeId,
    reason: parsed.data.reason,
    granted_by: ctx.user.id,
    starts_at: startsAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  })
  if (error) return dbFailure('support_grant', error)
  refresh()
  return successState()
}

export async function revokeSupportAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = z.uuid().safeParse(formData.get('grantId'))
  if (!id.success) return errorState('invalid')
  const { data, error } = await ctx.supabase
    .from('support_access_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id.data)
    .is('revoked_at', null)
    .select('id')
  if (error) return dbFailure('support_revoke', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}
