import { z } from 'zod'
import type { ValidationKey } from '@/lib/auth/schemas'

/**
 * Form and payload schemas for university management (Phase 3). Error messages are
 * dictionary keys (see auth/schemas.ts). Limits mirror the database constraints so the
 * user sees a friendly message before the database has to reject anything.
 */

const msg = (key: ValidationKey) => ({ error: key })

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,47}$/
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

const requiredText = (max: number, min = 1) =>
  z.string(msg('nameRequired')).trim().min(min, msg('nameRequired')).max(max, msg('nameTooLong'))

const optionalText = (max: number) =>
  z.string().trim().max(max, msg('nameTooLong')).optional().transform((v) => (v ? v : undefined))

export const emailField = z
  .string(msg('emailRequired'))
  .trim()
  .min(1, msg('emailRequired'))
  .max(254, msg('emailInvalid'))
  .pipe(z.email(msg('emailInvalid')))
  .transform((v) => v.toLowerCase())

const optionalEmail = z
  .string()
  .trim()
  .max(254, msg('emailInvalid'))
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .pipe(z.email(msg('emailInvalid')).optional())

export const slugField = z.string(msg('slugInvalid')).trim().toLowerCase().regex(SLUG_PATTERN, msg('slugInvalid'))

export const localeField = z.enum(['en', 'ar'], msg('invalidValue'))

export function isValidTimeZone(value: string): boolean {
  if (value === 'UTC') return true
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const timezoneField = z.string(msg('timezoneInvalid')).trim().min(1, msg('timezoneInvalid')).max(64, msg('timezoneInvalid')).refine(isValidTimeZone, msg('timezoneInvalid'))

const uuidField = z.uuid(msg('invalidValue'))

// --- Workspace -----------------------------------------------------------------

export const inviteSchema = z.object({
  email: emailField,
  roleKey: z.string(msg('roleRequired')).regex(ROLE_KEY_PATTERN, msg('roleRequired')),
  validDays: z.coerce.number(msg('invalidValue')).int(msg('invalidValue')).min(1, msg('invalidValue')).max(30, msg('invalidValue')).default(7),
})

export const memberStatusSchema = z.object({
  membershipId: uuidField,
  status: z.enum(['active', 'suspended'], msg('invalidValue')),
})

export const memberRoleSchema = z.object({
  membershipId: uuidField,
  roleId: uuidField,
  op: z.enum(['add', 'remove'], msg('invalidValue')),
})

export const memberDepartmentSchema = z.object({
  membershipId: uuidField,
  departmentId: uuidField,
  op: z.enum(['add', 'remove'], msg('invalidValue')),
})

export const departmentSchema = z.object({
  id: uuidField.optional(),
  name: requiredText(120, 2),
  nameAr: optionalText(120),
  slug: slugField,
  email: optionalEmail,
})

export const profileSchema = z.object({
  nameEn: optionalText(160),
  nameAr: optionalText(160),
  defaultLocale: localeField,
  timezone: timezoneField,
  supportEmail: optionalEmail,
})

const hex = z.string(msg('hexInvalid')).trim().regex(HEX_PATTERN, msg('hexInvalid')).transform((v) => v.toLowerCase())

export const brandingSchema = z.object({
  primary: hex,
  secondary: hex,
  accent: hex,
  assistantName: optionalText(60),
  assistantNameAr: optionalText(60),
  welcome: optionalText(280),
  welcomeAr: optionalText(280),
  monogram: z
    .string()
    .trim()
    .max(3, msg('nameTooLong'))
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
})

export type BrandingInput = z.infer<typeof brandingSchema>

/** Branding form values → the JSON stored in tenant_branding (validated again by the DB). */
export function toBrandingJson(input: BrandingInput, logoPath?: string | null): Record<string, string> {
  const out: Record<string, string> = { primary: input.primary, secondary: input.secondary, accent: input.accent }
  if (input.assistantName) out.assistant_name = input.assistantName
  if (input.assistantNameAr) out.assistant_name_ar = input.assistantNameAr
  if (input.welcome) out.welcome = input.welcome
  if (input.welcomeAr) out.welcome_ar = input.welcomeAr
  if (input.monogram) out.monogram = input.monogram
  if (logoPath) out.logo_path = logoPath
  return out
}

export const LOGO_MAX_BYTES = 1024 * 1024
export const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const

/**
 * Checks the file signature (magic bytes), not just the declared type, so a renamed
 * HTML/SVG file cannot be stored as a "PNG".
 */
export function sniffImageType(bytes: Uint8Array): keyof typeof LOGO_TYPES | null {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

// --- Platform ------------------------------------------------------------------

export const createTenantSchema = z.object({
  name: requiredText(160, 2),
  nameAr: optionalText(160),
  slug: slugField,
  defaultLocale: localeField,
  timezone: timezoneField,
  isDemo: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
  ownerEmail: optionalEmail,
})

export const tenantStatusSchema = z.object({
  slug: slugField,
  status: z.enum(['trial', 'active', 'suspended', 'archived'], msg('invalidValue')),
})

export const tenantFeatureSchema = z.object({
  slug: slugField,
  featureKey: z.string().regex(/^[a-z][a-z0-9_]*$/, msg('invalidValue')),
  enabled: z.enum(['true', 'false'], msg('invalidValue')).transform((v) => v === 'true'),
})

export const supportGrantSchema = z.object({
  slug: slugField,
  granteeId: uuidField,
  reason: z.string(msg('reasonRequired')).trim().min(10, msg('reasonRequired')).max(500, msg('nameTooLong')),
  hours: z.coerce.number(msg('invalidValue')).int(msg('invalidValue')).min(1, msg('invalidValue')).max(24, msg('invalidValue')),
})

// --- RPC payloads ----------------------------------------------------------------

export const membersPayloadSchema = z.array(
  z.object({
    membership_id: z.string(),
    user_id: z.string(),
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    status: z.enum(['invited', 'active', 'suspended']),
    joined_at: z.string(),
    role_keys: z.array(z.string()),
    department_ids: z.array(z.string()),
  }),
)
export type MemberRow = z.infer<typeof membersPayloadSchema>[number]

export const invitationsPayloadSchema = z.array(
  z.object({
    id: z.string(),
    email: z.string(),
    role_key: z.string(),
    role_name: z.string(),
    expires_at: z.string(),
    created_at: z.string(),
    expired: z.boolean(),
  }),
)
export type InvitationRow = z.infer<typeof invitationsPayloadSchema>[number]

export const invitationPreviewSchema = z
  .object({
    tenant_name: z.string(),
    tenant_name_translations: z.record(z.string(), z.string()).catch({}),
    role_key: z.string(),
    role_name: z.string(),
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    email_matches: z.boolean(),
    email_hint: z.string(),
    expires_at: z.string(),
  })
  .nullable()
export type InvitationPreview = NonNullable<z.infer<typeof invitationPreviewSchema>>

export const platformTenantsPayloadSchema = z.array(
  z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    name_translations: z.record(z.string(), z.string()).catch({}),
    status: z.enum(['trial', 'active', 'suspended', 'archived']),
    is_demo: z.boolean(),
    default_locale: z.string(),
    timezone: z.string(),
    created_at: z.string(),
    member_count: z.number(),
    pending_invitations: z.number(),
    features_enabled: z.number(),
  }),
)
export type PlatformTenantRow = z.infer<typeof platformTenantsPayloadSchema>[number]

export const platformStaffPayloadSchema = z.array(
  z.object({ user_id: z.string(), role: z.string(), email: z.string().nullable(), full_name: z.string().nullable() }),
)
export type PlatformStaffRow = z.infer<typeof platformStaffPayloadSchema>[number]
