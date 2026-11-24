import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { getMfaState, mfaStep, platformMfaRequired } from '@/lib/auth/mfa'
import { requireUser, type SessionUser } from '@/lib/auth/session'
import { DEMO_TENANTS, findDemoTenant, type TenantBrandingPreview } from '@/lib/branding/demo-tenants'
import { AppError } from '@/lib/errors'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { localizedPath, type Locale } from '@/lib/i18n/config'
import { logger } from '@/lib/logger'
import { canSeeNavItem, type AccessSnapshot } from '@/lib/navigation/workspace-nav'
import type { PermissionKey } from '@/lib/permissions/catalog'
import type { FeatureKey } from '@/lib/features/catalog'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  tenantAccessPayloadSchema,
  toTenantAccess,
  toTenantSummary,
  workspacesPayloadSchema,
  type TenantSummary,
} from './mappers'

/**
 * Tenant context for the workspace (docs/tenant-isolation.md §4).
 *
 * Real users: everything comes from the database through self-scoped SECURITY DEFINER
 * functions (my_workspaces, my_tenant_access, my_platform_role) that only ever describe
 * the caller, on top of Row Level Security. A slug the caller is not a member of yields
 * "not found" — exactly like a slug that does not exist (no tenant enumeration).
 *
 * UI preview mode (no auth backend configured, ADR-012) uses the fictional fixtures.
 */

export type { TenantSummary }

export type WorkspaceContext = {
  user: SessionUser
  /** Database id of the tenant (null in UI preview mode, which has no data). */
  tenantId: string | null
  tenant: TenantSummary
  memberships: TenantSummary[]
  access: AccessSnapshot
  accessVia: 'membership' | 'support' | 'preview'
  roles: string[]
  departmentIds: string[]
  canAccessPlatformConsole: boolean
}

const log = logger.child({ module: 'tenancy' })

function previewSummary(t: TenantBrandingPreview, locale: Locale): TenantSummary {
  return {
    slug: t.slug,
    name: t.name[locale],
    shortName: t.shortName,
    monogram: t.monogram,
    assistantName: t.assistantName[locale],
    welcome: t.welcome[locale],
    colors: t.colors,
    defaultLocale: 'en',
    timezone: 'UTC',
    status: 'trial',
    isDemo: true,
  }
}

function fallbacks(locale: Locale) {
  const dict = getDictionary(locale)
  return { assistantName: dict.workspace.defaultAssistantName, welcome: dict.workspace.defaultWelcome }
}

function rpcFailure(name: string, error: { code?: string; message?: string }): never {
  log.error('tenancy.rpc_failed', { rpc: name, code: error.code })
  throw new AppError('internal', `${name} failed`)
}

/** The caller's platform role (null for everyone who is not platform staff). */
export const getPlatformRole = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('my_platform_role')
  if (error) rpcFailure('my_platform_role', error)
  return data ?? null
})

/** Workspaces the current user can open. Deduplicated per request. */
export const listWorkspacesForUser = cache(async (locale: Locale): Promise<{ user: SessionUser; workspaces: TenantSummary[] }> => {
  const user = await requireUser(locale, localizedPath(locale, '/app'))
  if (user.isPreview) return { user, workspaces: DEMO_TENANTS.map((t) => previewSummary(t, locale)) }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('my_workspaces')
  if (error) rpcFailure('my_workspaces', error)
  const parsed = workspacesPayloadSchema.safeParse(data)
  if (!parsed.success) {
    log.error('tenancy.invalid_payload', { rpc: 'my_workspaces' })
    throw new AppError('internal', 'Invalid workspaces payload')
  }
  const fb = fallbacks(locale)
  return { user, workspaces: parsed.data.map((w) => toTenantSummary(w, w.branding, locale, fb)) }
})

export const getWorkspaceContext = cache(async (locale: Locale, slug: string): Promise<WorkspaceContext> => {
  // Authenticate first so a login redirect returns the user to this exact workspace.
  await requireUser(locale, localizedPath(locale, `/app/${encodeURIComponent(slug)}`))
  const { user, workspaces } = await listWorkspacesForUser(locale)

  if (user.isPreview) {
    const tenant = findDemoTenant(slug)
    if (!tenant) notFound()
    return {
      user,
      tenantId: null,
      tenant: previewSummary(tenant, locale),
      memberships: workspaces,
      access: { kind: 'all' }, // preview has no data behind any page
      accessVia: 'preview',
      roles: [],
      departmentIds: [],
      canAccessPlatformConsole: true,
    }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('my_tenant_access', { p_slug: slug })
  if (error) rpcFailure('my_tenant_access', error)
  if (data === null) notFound() // not a member (or no such tenant): identical response

  const parsed = tenantAccessPayloadSchema.safeParse(data)
  if (!parsed.success) {
    log.error('tenancy.invalid_payload', { rpc: 'my_tenant_access' })
    throw new AppError('internal', 'Invalid tenant access payload')
  }
  const access = toTenantAccess(parsed.data)
  const platformRole = await getPlatformRole()

  return {
    user,
    tenantId: access.tenantId,
    tenant: toTenantSummary(parsed.data.tenant, parsed.data.branding, locale, fallbacks(locale)),
    memberships: workspaces,
    access: access.access,
    accessVia: access.accessVia,
    roles: access.roles,
    departmentIds: access.departmentIds,
    canAccessPlatformConsole: platformRole !== null,
  }
})

/** Does the caller hold this permission in the workspace? (Preview: everything is visible.) */
export function hasWorkspacePermission(ctx: WorkspaceContext, permission: PermissionKey): boolean {
  return ctx.access.kind === 'all' || ctx.access.permissions.has(permission)
}

/** Does the university have this feature on (UI preview: every feature)? */
export function hasWorkspaceFeature(ctx: WorkspaceContext, feature: FeatureKey): boolean {
  return ctx.access.kind === 'all' || ctx.access.features.has(feature)
}

/** Server-side gate for a page or action inside a workspace. Unauthorized → not found. */
export function requireWorkspaceAccess(ctx: WorkspaceContext, need: { permission?: PermissionKey; feature?: FeatureKey | readonly FeatureKey[] }): void {
  const allowed = canSeeNavItem({ key: '', segment: '', icon: 'overview', status: 'available', phase: 0, ...need }, ctx.access)
  if (!allowed) notFound()
}

/** Platform console gate: platform staff only (platform_admins), or UI preview. */
export const requirePlatformAccess = cache(async (locale: Locale): Promise<{ user: SessionUser; role: string | null }> => {
  const user = await requireUser(locale, localizedPath(locale, '/platform'))
  if (user.isPreview) return { user, role: 'owner' }
  const role = await getPlatformRole()
  if (!role) notFound()
  // Platform staff must use two-step sign-in (ADR-036); requireUser already asked for the code.
  if (platformMfaRequired()) {
    const state = await getMfaState(await createSupabaseServerClient(), true)
    if (mfaStep(state, true) === 'enroll') redirect(localizedPath(locale, '/two-step?required=platform'))
  }
  return { user, role }
})
