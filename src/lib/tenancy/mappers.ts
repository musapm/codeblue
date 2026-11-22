import { z } from 'zod'
import { logoPublicUrl } from '@/lib/branding/logo'
import { resolveTheme, type ThemeColors } from '@/lib/branding/theme'
import type { Locale } from '@/lib/i18n/config'
import type { AccessSnapshot } from '@/lib/navigation/workspace-nav'

/**
 * Pure mappers from database RPC payloads (my_workspaces / my_tenant_access) to the
 * shapes the UI uses. Payloads are validated with zod first — the UI never trusts
 * unvalidated JSON, and branding colors always pass through the hex-only theme engine.
 */

export const TENANT_STATUSES = ['trial', 'active', 'suspended', 'archived'] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

const brandingSchema = z
  .looseObject({
    primary: z.string().optional(),
    secondary: z.string().optional(),
    accent: z.string().optional(),
    assistant_name: z.string().max(60).optional(),
    assistant_name_ar: z.string().max(60).optional(),
    welcome: z.string().max(280).optional(),
    welcome_ar: z.string().max(280).optional(),
    monogram: z.string().max(3).optional(),
    logo_path: z.string().optional(),
  })
  .catch({})

const tenantSchema = z.object({
  slug: z.string(),
  name: z.string(),
  name_translations: z.record(z.string(), z.string()).catch({}),
  status: z.enum(TENANT_STATUSES),
  default_locale: z.enum(['en', 'ar']).catch('en'),
  timezone: z.string(),
  is_demo: z.boolean().catch(false),
})

export const workspacesPayloadSchema = z.array(tenantSchema.extend({ branding: brandingSchema }))

export const tenantAccessPayloadSchema = z.object({
  tenant: tenantSchema.extend({ id: z.string() }),
  branding: brandingSchema,
  access_via: z.enum(['membership', 'support']),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  department_ids: z.array(z.string()),
  features: z.array(z.string()),
})

export type TenantSummary = {
  slug: string
  name: string
  shortName: string
  monogram: string
  logoUrl?: string
  assistantName: string
  welcome: string
  colors: ThemeColors
  defaultLocale: Locale
  timezone: string
  status: TenantStatus
  isDemo: boolean
}

export type TenantAccess = {
  tenantId: string
  accessVia: 'membership' | 'support'
  roles: string[]
  departmentIds: string[]
  access: AccessSnapshot
}

/** Up to two initials from the (Latin) tenant name, e.g. "Northbridge University" → "NU". */
export function deriveMonogram(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|for)$/i.test(w))
    .map((w) => w[0]!.toUpperCase())
  return (letters.slice(0, 2).join('') || name.slice(0, 2).toUpperCase()).slice(0, 3)
}

type TenantRow = z.infer<typeof tenantSchema>
type BrandingRow = z.infer<typeof brandingSchema>

export function toTenantSummary(
  tenant: TenantRow,
  branding: BrandingRow,
  locale: Locale,
  fallbacks: { assistantName: (name: string) => string; welcome: string },
): TenantSummary {
  const localizedName = tenant.name_translations[locale]?.trim() || tenant.name
  const assistantName = (locale === 'ar' ? branding.assistant_name_ar : undefined) || branding.assistant_name || fallbacks.assistantName(localizedName)
  const welcome = (locale === 'ar' ? branding.welcome_ar : undefined) || branding.welcome || fallbacks.welcome
  return {
    slug: tenant.slug,
    name: localizedName,
    shortName: tenant.name,
    monogram: branding.monogram?.toUpperCase() || deriveMonogram(tenant.name),
    logoUrl: logoPublicUrl(branding.logo_path),
    assistantName,
    welcome,
    colors: resolveTheme(branding),
    defaultLocale: tenant.default_locale,
    timezone: tenant.timezone,
    status: tenant.status,
    isDemo: tenant.is_demo,
  }
}

/**
 * What a support-access session may look at (read-only troubleshooting, ADR-014). The
 * database grants support sessions no tenant permissions and rejects every write; these
 * keys only decide which read-only pages are shown, and each of them is backed by a read
 * path the database allows for support grants (tenant_members, settings, features).
 */
export const SUPPORT_READ_PERMISSIONS = ['tenant.settings.read', 'tenant.features.read', 'members.read'] as const

export function toTenantAccess(payload: z.infer<typeof tenantAccessPayloadSchema>): TenantAccess {
  const permissions = payload.access_via === 'support' ? [...SUPPORT_READ_PERMISSIONS] : payload.permissions
  return {
    tenantId: payload.tenant.id,
    accessVia: payload.access_via,
    roles: payload.roles,
    departmentIds: payload.department_ids,
    access: { kind: 'scoped', permissions: new Set(permissions), features: new Set(payload.features) },
  }
}

export function isOperating(status: TenantStatus): boolean {
  return status === 'trial' || status === 'active'
}
