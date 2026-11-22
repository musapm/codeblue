'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { publicEnv } from '@/lib/env/public'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, log, readLocale } from './action-helpers'
import { errorState, successState, type ActionState } from './action-state'
import {
  brandingSchema,
  departmentSchema,
  inviteSchema,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  memberDepartmentSchema,
  memberRoleSchema,
  memberStatusSchema,
  profileSchema,
  slugField,
  sniffImageType,
  toBrandingJson,
} from './schemas'

/**
 * Write side of university management (Phase 3). Each action:
 *   1. requires a real signed-in user (preview mode is read-only),
 *   2. validates input with zod (dictionary-key errors),
 *   3. lets the database authorize (RLS, SECURITY DEFINER checks, owner guards),
 *   4. detects "0 rows changed" (RLS hides rows instead of raising) as forbidden,
 *   5. refreshes the router so server components re-read the data.
 */

const tenantIdField = z.uuid()

function readTenant(formData: FormData): { tenantId: string; slug: string } | null {
  const tenantId = tenantIdField.safeParse(formData.get('tenantId'))
  const slug = slugField.safeParse(formData.get('tenant'))
  return tenantId.success && slug.success ? { tenantId: tenantId.data, slug: slug.data } : null
}

// --- Invitations -------------------------------------------------------------------

export type InviteResult = { link: string; email: string; expiresAt: string }

export async function inviteMember(_prev: ActionState<InviteResult>, formData: FormData): Promise<ActionState<InviteResult>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = inviteSchema.safeParse(formValues(formData, ['email', 'roleKey', 'validDays'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('invite', ctx.user.id)) return errorState('rateLimited')

  const { data, error } = await ctx.supabase.rpc('create_invitation', {
    p_tenant_slug: slug.data,
    p_email: parsed.data.email,
    p_role_key: parsed.data.roleKey,
    p_valid_days: parsed.data.validDays,
  })
  if (error) return dbFailure('create_invitation', error)
  const inv = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/), expires_at: z.string() }).safeParse(data)
  if (!inv.success) return errorState('generic')

  refresh()
  // The raw token is shown once to the inviter (email delivery arrives with transactional email).
  return successState({ link: `${publicEnv.siteUrl}${localizedPath(locale, `/invite/${inv.data.token}`)}`, email: parsed.data.email, expiresAt: inv.data.expires_at })
}

export async function revokeInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const id = z.uuid().safeParse(formData.get('invitationId'))
  if (!id.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('revoke_invitation', { p_invitation: id.data })
  if (error) return dbFailure('revoke_invitation', error)
  refresh()
  return successState()
}

/** Accept an invitation for the signed-in user, then open the university workspace. */
export async function acceptInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const token = z.string().regex(/^[0-9a-f]{64}$/).safeParse(formData.get('token'))
  if (!token.success) return errorState('notFound')
  if (await isRateLimited('accept', ctx.user.id)) return errorState('rateLimited')

  const { data, error } = await ctx.supabase.rpc('accept_invitation', { p_token: token.data })
  if (error) return dbFailure('accept_invitation', error)
  const slug = slugField.safeParse(data)
  if (!slug.success) return errorState('generic')
  log.info('management.invitation_accepted', { tenant: slug.data })
  redirect(localizedPath(locale, `/app/${slug.data}`))
}

// --- Members -------------------------------------------------------------------------

export async function setMemberStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  const parsed = memberStatusSchema.safeParse(formValues(formData, ['membershipId', 'status'] as const))
  if (!t || !parsed.success) return errorState('invalid')

  const { data, error } = await ctx.supabase
    .from('tenant_memberships')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.membershipId)
    .eq('tenant_id', t.tenantId)
    .neq('user_id', ctx.user.id) // nobody suspends themselves from the UI
    .select('id')
  if (error) return dbFailure('member_status', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  const id = z.uuid().safeParse(formData.get('membershipId'))
  if (!t || !id.success) return errorState('invalid')

  const { data, error } = await ctx.supabase
    .from('tenant_memberships')
    .delete()
    .eq('id', id.data)
    .eq('tenant_id', t.tenantId)
    .neq('user_id', ctx.user.id)
    .select('id')
  if (error) return dbFailure('member_remove', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

export async function changeMemberRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  const parsed = memberRoleSchema.safeParse(formValues(formData, ['membershipId', 'roleId', 'op'] as const))
  if (!t || !parsed.success) return errorState('invalid')
  const { membershipId, roleId, op } = parsed.data

  if (op === 'add') {
    const { error } = await ctx.supabase.from('membership_roles').insert({ tenant_id: t.tenantId, membership_id: membershipId, role_id: roleId })
    if (error) return dbFailure('role_add', error)
  } else {
    const { data, error } = await ctx.supabase
      .from('membership_roles')
      .delete()
      .eq('tenant_id', t.tenantId)
      .eq('membership_id', membershipId)
      .eq('role_id', roleId)
      .select('role_id')
    if (error) return dbFailure('role_remove', error)
    if (!data?.length) return errorState('forbidden')
  }
  refresh()
  return successState()
}

export async function changeMemberDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  const parsed = memberDepartmentSchema.safeParse(formValues(formData, ['membershipId', 'departmentId', 'op'] as const))
  if (!t || !parsed.success) return errorState('invalid')
  const { membershipId, departmentId, op } = parsed.data

  if (op === 'add') {
    const { error } = await ctx.supabase
      .from('membership_departments')
      .insert({ tenant_id: t.tenantId, membership_id: membershipId, department_id: departmentId })
    if (error) return dbFailure('department_assign', error)
  } else {
    const { data, error } = await ctx.supabase
      .from('membership_departments')
      .delete()
      .eq('tenant_id', t.tenantId)
      .eq('membership_id', membershipId)
      .eq('department_id', departmentId)
      .select('department_id')
    if (error) return dbFailure('department_unassign', error)
    if (!data?.length) return errorState('forbidden')
  }
  refresh()
  return successState()
}

// --- Departments ---------------------------------------------------------------------

export async function saveDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  if (!t) return errorState('invalid')
  const parsed = departmentSchema.safeParse(formValues(formData, ['id', 'name', 'nameAr', 'slug', 'email'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { id, name, nameAr, slug, email } = parsed.data
  const row = { name, slug, email: email ?? null, name_translations: nameAr ? { en: name, ar: nameAr } : { en: name } }

  if (id) {
    const { data, error } = await ctx.supabase.from('departments').update(row).eq('id', id).eq('tenant_id', t.tenantId).select('id')
    if (error) return error.code === '23505' ? errorState('conflict', { slug: 'slugTaken' }) : dbFailure('department_update', error)
    if (!data?.length) return errorState('forbidden')
  } else {
    const { error } = await ctx.supabase.from('departments').insert({ ...row, tenant_id: t.tenantId })
    if (error) return error.code === '23505' ? errorState('conflict', { slug: 'slugTaken' }) : dbFailure('department_create', error)
  }
  refresh()
  return successState()
}

export async function setDepartmentArchived(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  const id = z.uuid().safeParse(formData.get('departmentId'))
  const archived = formData.get('archived') === 'true'
  if (!t || !id.success) return errorState('invalid')

  const { data, error } = await ctx.supabase
    .from('departments')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id.data)
    .eq('tenant_id', t.tenantId)
    .select('id')
  if (error) return dbFailure('department_archive', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

// --- University profile --------------------------------------------------------------

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  if (!t) return errorState('invalid')
  const parsed = profileSchema.safeParse(formValues(formData, ['nameEn', 'nameAr', 'defaultLocale', 'timezone', 'supportEmail'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { nameEn, nameAr, defaultLocale, timezone, supportEmail } = parsed.data

  const translations: Record<string, string> = {}
  if (nameEn) translations.en = nameEn
  if (nameAr) translations.ar = nameAr
  const profile = await ctx.supabase.rpc('update_tenant_profile', {
    p_tenant_slug: t.slug,
    p_name_translations: translations,
    p_default_locale: defaultLocale,
    p_timezone: timezone,
  })
  if (profile.error) return dbFailure('update_tenant_profile', profile.error)

  const settings = await ctx.supabase.from('tenant_settings').update({ support_email: supportEmail ?? null }).eq('tenant_id', t.tenantId).select('tenant_id')
  if (settings.error) return dbFailure('tenant_settings', settings.error)
  if (!settings.data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

// --- Branding ------------------------------------------------------------------------

/** Save the branding draft; with intent=publish also publish it (published_by = caller). */
export async function saveBranding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  if (!t) return errorState('invalid')
  const parsed = brandingSchema.safeParse(
    formValues(formData, ['primary', 'secondary', 'accent', 'assistantName', 'assistantNameAr', 'welcome', 'welcomeAr', 'monogram'] as const),
  )
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))

  const existing = await ctx.supabase.from('tenant_branding').select('draft, published').eq('tenant_id', t.tenantId).maybeSingle()
  if (existing.error) return dbFailure('branding_read', existing.error)
  if (!existing.data) return errorState('forbidden')
  const logoPath = formData.get('removeLogo') === 'true' ? null : pickLogoPath(existing.data.draft) ?? pickLogoPath(existing.data.published)

  const saved = await ctx.supabase
    .from('tenant_branding')
    .update({ draft: toBrandingJson(parsed.data, logoPath) })
    .eq('tenant_id', t.tenantId)
    .select('tenant_id')
  if (saved.error) return dbFailure('branding_save', saved.error)
  if (!saved.data?.length) return errorState('forbidden')

  if (formData.get('intent') === 'publish') {
    const published = await ctx.supabase.rpc('publish_branding', { p_tenant_slug: t.slug })
    if (published.error) return dbFailure('publish_branding', published.error)
  }
  refresh()
  return successState()
}

function pickLogoPath(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const v = (json as Record<string, unknown>).logo_path
  return typeof v === 'string' ? v : null
}

/**
 * Upload a logo into the tenant's folder of the public `tenant-assets` bucket (storage
 * RLS: tenant.branding.manage of that tenant) and reference it from the draft.
 */
export async function uploadLogo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const t = readTenant(formData)
  const file = formData.get('logo')
  if (!t) return errorState('invalid')
  if (!(file instanceof File) || file.size === 0) return errorState('invalid', { logo: 'fileRequired' })
  if (file.size > LOGO_MAX_BYTES) return errorState('invalid', { logo: 'fileTooLarge' })
  if (await isRateLimited('upload', ctx.user.id)) return errorState('rateLimited')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type) return errorState('invalid', { logo: 'fileType' })

  const path = `${t.tenantId}/logo-${crypto.randomUUID().slice(0, 8)}.${LOGO_TYPES[type]}`
  const upload = await ctx.supabase.storage.from('tenant-assets').upload(path, bytes, { contentType: type, upsert: false, cacheControl: '31536000' })
  if (upload.error) return dbFailure('logo_upload', { code: (upload.error as { statusCode?: string }).statusCode, message: upload.error.message })

  const existing = await ctx.supabase.from('tenant_branding').select('draft, published').eq('tenant_id', t.tenantId).maybeSingle()
  if (existing.error) return dbFailure('branding_read', existing.error)
  const base = (existing.data?.draft ?? existing.data?.published ?? {}) as Record<string, unknown>
  const saved = await ctx.supabase
    .from('tenant_branding')
    .update({ draft: { ...base, logo_path: path } })
    .eq('tenant_id', t.tenantId)
    .select('tenant_id')
  if (saved.error) return dbFailure('branding_logo', saved.error)
  if (!saved.data?.length) return errorState('forbidden')
  refresh()
  return successState()
}
