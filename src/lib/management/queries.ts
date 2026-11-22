import 'server-only'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  invitationPreviewSchema,
  invitationsPayloadSchema,
  membersPayloadSchema,
  platformStaffPayloadSchema,
  platformTenantsPayloadSchema,
  type InvitationPreview,
  type InvitationRow,
  type MemberRow,
  type PlatformStaffRow,
  type PlatformTenantRow,
} from './schemas'

/**
 * Read side of university management. Every query runs as the signed-in user, so Row
 * Level Security and the functions' own checks decide what is returned. Callers gate
 * pages by permission first; an authorization error here means the UI and the database
 * disagree, which is logged and surfaced as an error, never silently ignored.
 */

const log = logger.child({ module: 'management' })

type DbErrorLike = { code?: string; message?: string } | null

function fail(op: string, error: NonNullable<DbErrorLike>): never {
  log.error('management.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

function parse<T>(op: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    log.error('management.invalid_payload', { op })
    throw new AppError('internal', `${op}: invalid payload`)
  }
  return parsed.data
}

// Role display order follows the catalog templates (owners first, students last).
export const ROLE_ORDER = [
  'university_owner',
  'university_admin',
  'department_admin',
  'admissions_staff',
  'registrar',
  'student_affairs',
  'finance_staff',
  'it_support',
  'academic_affairs',
  'library_staff',
  'hr_staff',
  'quality_reviewer',
  'student',
]

export type RoleRow = { id: string; key: string; name: string; description: string | null; isSystem: boolean; permissions: string[] }
export type DepartmentRow = { id: string; slug: string; name: string; nameAr: string | null; email: string | null; archivedAt: string | null; createdAt: string }

// --- Workspace -------------------------------------------------------------------

export async function listMembers(slug: string): Promise<MemberRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('tenant_members', { p_tenant_slug: slug })
  if (error) fail('tenant_members', error)
  return parse('tenant_members', membersPayloadSchema, data)
}

export async function listInvitations(slug: string): Promise<InvitationRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('tenant_invitations', { p_tenant_slug: slug })
  if (error) fail('tenant_invitations', error)
  return parse('tenant_invitations', invitationsPayloadSchema, data)
}

export async function listRoles(tenantId: string): Promise<RoleRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('roles')
    .select('id, key, name, description, is_system, role_permissions(permission_key)')
    .eq('tenant_id', tenantId)
  if (error) fail('roles', error)
  const rank = (key: string) => {
    const i = ROLE_ORDER.indexOf(key)
    return i === -1 ? ROLE_ORDER.length : i
  }
  return (data ?? [])
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
      permissions: (r.role_permissions ?? []).map((p) => p.permission_key).sort(),
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name))
}

export async function listDepartments(tenantId: string): Promise<DepartmentRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('departments')
    .select('id, slug, name, name_translations, email, archived_at, created_at')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) fail('departments', error)
  return (data ?? []).map((d) => {
    const tr = (d.name_translations ?? {}) as Record<string, unknown>
    return {
      id: d.id,
      slug: d.slug,
      name: d.name,
      nameAr: typeof tr.ar === 'string' ? tr.ar : null,
      email: d.email,
      archivedAt: d.archived_at,
      createdAt: d.created_at,
    }
  })
}

export type TenantProfile = {
  name: string
  nameEn: string | null
  nameAr: string | null
  defaultLocale: 'en' | 'ar'
  timezone: string
  supportEmail: string | null
}

export async function getTenantProfile(tenantId: string): Promise<TenantProfile> {
  const supabase = await createSupabaseServerClient()
  const [tenant, settings] = await Promise.all([
    supabase.from('tenants').select('name, name_translations, default_locale, timezone').eq('id', tenantId).single(),
    supabase.from('tenant_settings').select('support_email').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (tenant.error) fail('tenant_profile', tenant.error)
  if (settings.error) fail('tenant_settings', settings.error)
  const tr = (tenant.data.name_translations ?? {}) as Record<string, unknown>
  return {
    name: tenant.data.name,
    nameEn: typeof tr.en === 'string' ? tr.en : null,
    nameAr: typeof tr.ar === 'string' ? tr.ar : null,
    defaultLocale: tenant.data.default_locale === 'ar' ? 'ar' : 'en',
    timezone: tenant.data.timezone,
    supportEmail: settings.data?.support_email ?? null,
  }
}

export type BrandingState = {
  draft: Record<string, unknown> | null
  published: Record<string, unknown>
  publishedAt: string | null
  updatedAt: string
}

export async function getBranding(tenantId: string): Promise<BrandingState> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('tenant_branding').select('draft, published, published_at, updated_at').eq('tenant_id', tenantId).single()
  if (error) fail('tenant_branding', error)
  const asObject = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
  return { draft: asObject(data.draft), published: asObject(data.published) ?? {}, publishedAt: data.published_at, updatedAt: data.updated_at }
}

export type AuditRow = {
  id: number
  tenantId: string | null
  actorId: string | null
  actorType: string
  action: string
  targetType: string | null
  targetId: string | null
  changedFields: string[]
  createdAt: string
}

const AUDIT_PAGE_SIZE = 50

function changedFields(metadata: unknown): string[] {
  const m = (metadata ?? {}) as { old?: Record<string, unknown>; new?: Record<string, unknown> }
  if (!m.old || !m.new) return []
  const ignore = new Set(['updated_at', 'created_at'])
  return Object.keys(m.new).filter((k) => !ignore.has(k) && JSON.stringify(m.new![k]) !== JSON.stringify(m.old![k]))
}

/** Audit entries, newest first. `beforeId` pages backwards (keyset pagination). */
export async function listAuditLogs(opts: { tenantId?: string; beforeId?: number }): Promise<{ rows: AuditRow[]; nextBeforeId: number | null }> {
  const supabase = await createSupabaseServerClient()
  let q = supabase
    .from('audit_logs')
    .select('id, tenant_id, actor_id, actor_type, action, target_type, target_id, metadata, created_at')
    .order('id', { ascending: false })
    .limit(AUDIT_PAGE_SIZE + 1)
  if (opts.tenantId) q = q.eq('tenant_id', opts.tenantId)
  if (opts.beforeId) q = q.lt('id', opts.beforeId)
  const { data, error } = await q
  if (error) fail('audit_logs', error)
  const rows = (data ?? []).slice(0, AUDIT_PAGE_SIZE).map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    actorId: r.actor_id,
    actorType: r.actor_type,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    changedFields: changedFields(r.metadata),
    createdAt: r.created_at,
  }))
  const hasMore = (data ?? []).length > AUDIT_PAGE_SIZE
  return { rows, nextBeforeId: hasMore ? rows[rows.length - 1]!.id : null }
}

// --- Invitations ------------------------------------------------------------------

export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('invitation_preview', { p_token: token })
  if (error) fail('invitation_preview', error)
  return parse('invitation_preview', invitationPreviewSchema, data)
}

// --- Platform ---------------------------------------------------------------------

export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('platform_tenants')
  if (error) fail('platform_tenants', error)
  return parse('platform_tenants', platformTenantsPayloadSchema, data)
}

export async function listPlatformStaff(): Promise<PlatformStaffRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('platform_staff')
  if (error) fail('platform_staff', error)
  return parse('platform_staff', platformStaffPayloadSchema, data)
}

export type PlatformTenantDetail = {
  id: string
  slug: string
  name: string
  nameAr: string | null
  status: 'trial' | 'active' | 'suspended' | 'archived'
  isDemo: boolean
  defaultLocale: string
  timezone: string
  createdAt: string
  features: { key: string; description: string; plannedPhase: number; enabled: boolean }[]
  supportGrants: { id: string; granteeId: string; reason: string; startsAt: string; expiresAt: string; revokedAt: string | null; grantedBy: string | null; active: boolean }[]
}

export async function getPlatformTenant(slug: string): Promise<PlatformTenantDetail | null> {
  const supabase = await createSupabaseServerClient()
  const tenant = await supabase
    .from('tenants')
    .select('id, slug, name, name_translations, status, is_demo, default_locale, timezone, created_at')
    .eq('slug', slug)
    .maybeSingle()
  if (tenant.error) fail('platform_tenant', tenant.error)
  if (!tenant.data) return null
  const t = tenant.data

  const [catalog, enabled, grants] = await Promise.all([
    supabase.from('features').select('key, description, planned_phase').order('planned_phase').order('key'),
    supabase.from('tenant_features').select('feature_key, enabled').eq('tenant_id', t.id),
    supabase
      .from('support_access_grants')
      .select('id, grantee_id, reason, starts_at, expires_at, revoked_at, granted_by')
      .eq('tenant_id', t.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  if (catalog.error) fail('features', catalog.error)
  if (enabled.error) fail('tenant_features', enabled.error)
  if (grants.error) fail('support_access_grants', grants.error)

  const on = new Map((enabled.data ?? []).map((f) => [f.feature_key, f.enabled]))
  const now = Date.now()
  const tr = (t.name_translations ?? {}) as Record<string, unknown>
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    nameAr: typeof tr.ar === 'string' ? tr.ar : null,
    status: t.status,
    isDemo: t.is_demo,
    defaultLocale: t.default_locale,
    timezone: t.timezone,
    createdAt: t.created_at,
    features: (catalog.data ?? []).map((f) => ({ key: f.key, description: f.description, plannedPhase: f.planned_phase, enabled: on.get(f.key) ?? false })),
    supportGrants: (grants.data ?? []).map((g) => ({
      id: g.id,
      granteeId: g.grantee_id,
      reason: g.reason,
      startsAt: g.starts_at,
      expiresAt: g.expires_at,
      revokedAt: g.revoked_at,
      grantedBy: g.granted_by,
      active: !g.revoked_at && new Date(g.starts_at).getTime() <= now && new Date(g.expires_at).getTime() > now,
    })),
  }
}
