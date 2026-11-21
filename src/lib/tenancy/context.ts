import 'server-only'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { requireUser, type SessionUser } from '@/lib/auth/session'
import { DEMO_TENANTS, findDemoTenant, type TenantBrandingPreview } from '@/lib/branding/demo-tenants'
import { localizedPath, type Locale } from '@/lib/i18n/config'
import type { AccessSnapshot } from '@/lib/navigation/workspace-nav'

/**
 * Tenant context for the workspace (see docs/tenant-isolation.md §4).
 *
 * PHASE 1 STATUS: tenants do not exist in a database yet. Only UI preview mode (which
 * requires that no auth backend is configured) resolves the fictional demo tenants.
 * Real signed-in users get "not found" until Phase 2 replaces this with an RLS-backed
 * membership lookup — there is intentionally no code path that trusts a slug alone.
 */

export type TenantSummary = {
  slug: string
  name: string
  shortName: string
  monogram: string
  assistantName: string
  welcome: string
  colors: TenantBrandingPreview['colors']
  defaultLocale: Locale
  timezone: string
}

export type WorkspaceContext = {
  user: SessionUser
  tenant: TenantSummary
  memberships: TenantSummary[]
  access: AccessSnapshot
  canAccessPlatformConsole: boolean
}

function toSummary(t: TenantBrandingPreview, locale: Locale): TenantSummary {
  return {
    slug: t.slug,
    name: t.name[locale],
    shortName: t.shortName,
    monogram: t.monogram,
    assistantName: t.assistantName[locale],
    welcome: t.welcome[locale],
    colors: t.colors,
    defaultLocale: 'en',
    timezone: 'Africa/Khartoum',
  }
}

/** Workspaces the current user can open. Deduplicated per request. */
export const listWorkspacesForUser = cache(async (locale: Locale): Promise<{ user: SessionUser; workspaces: TenantSummary[] }> => {
  const user = await requireUser(locale, localizedPath(locale, '/app'))
  if (user.isPreview) return { user, workspaces: DEMO_TENANTS.map((t) => toSummary(t, locale)) }
  // Phase 2: select tenants joined to tenant_memberships for auth.uid(), via RLS.
  return { user, workspaces: [] }
})

export const getWorkspaceContext = cache(async (locale: Locale, slug: string): Promise<WorkspaceContext> => {
  // Authenticate first so the login redirect returns the user to this exact workspace.
  await requireUser(locale, localizedPath(locale, `/app/${encodeURIComponent(slug)}`))
  const { user, workspaces } = await listWorkspacesForUser(locale)
  if (!user.isPreview) notFound() // Phase 2 replaces this with a membership-checked lookup.

  const tenant = findDemoTenant(slug)
  if (!tenant) notFound()

  return {
    user,
    tenant: toSummary(tenant, locale),
    memberships: workspaces,
    // Preview has no data behind any page, so every navigation item is shown.
    access: { kind: 'all' },
    canAccessPlatformConsole: true,
  }
})

/** Platform console gate. Phase 2 checks the platform_admins table. */
export const requirePlatformAccess = cache(async (locale: Locale): Promise<SessionUser> => {
  const user = await requireUser(locale, localizedPath(locale, '/platform'))
  if (!user.isPreview) notFound()
  return user
})
