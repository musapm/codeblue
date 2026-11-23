import { z } from 'zod'
import type { ValidationKey } from '@/lib/auth/schemas'
import type { Json } from '@/lib/supabase/database.types'

/** Knowledge document metadata (form ⇄ database JSON). Mirrors the table constraints. */

const msg = (key: ValidationKey) => ({ error: key })
const optionalText = (max: number) =>
  z.string().trim().max(max, msg('nameTooLong')).optional().transform((v) => (v ? v : undefined))
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.iso.date(msg('dateInvalid')).optional())

export const KNOWLEDGE_VISIBILITIES = ['public', 'members', 'staff', 'restricted'] as const
export const KNOWLEDGE_LANGUAGES = ['en', 'ar', 'mixed'] as const

export const knowledgeMetaSchema = z
  .object({
    title: z.string(msg('nameRequired')).trim().min(2, msg('nameRequired')).max(200, msg('nameTooLong')),
    titleAr: optionalText(200),
    description: optionalText(1000),
    language: z.enum(KNOWLEDGE_LANGUAGES, msg('invalidValue')).default('en'),
    departmentId: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.uuid(msg('invalidValue')).optional()),
    category: optionalText(60),
    visibility: z.enum(KNOWLEDGE_VISIBILITIES, msg('invalidValue')).default('staff'),
    isAuthoritative: z.boolean().default(false),
    sourcePriority: z.coerce.number(msg('invalidValue')).int(msg('invalidValue')).min(0, msg('invalidValue')).max(100, msg('invalidValue')).default(50),
    effectiveDate: optionalDate,
    expiryDate: optionalDate,
    sourceUrl: z
      .string()
      .trim()
      .max(2000, msg('urlInvalid'))
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.url({ protocol: /^https$/, error: 'urlInvalid' }).optional()),
    accessDepartmentIds: z.array(z.uuid(msg('invalidValue'))).max(50).default([]),
    accessRoleIds: z.array(z.uuid(msg('invalidValue'))).max(50).default([]),
  })
  .refine((m) => !m.effectiveDate || !m.expiryDate || m.expiryDate >= m.effectiveDate, { path: ['expiryDate'], ...msg('dateOrder') })
  .refine((m) => m.visibility !== 'restricted' || m.accessDepartmentIds.length + m.accessRoleIds.length > 0, {
    path: ['visibility'],
    ...msg('restrictedNeedsAccess'),
  })

export type KnowledgeMetaInput = z.input<typeof knowledgeMetaSchema>

/** Form values → the JSON accepted by knowledge_begin_upload / knowledge_update_document. */
export function toMetaJson(m: z.output<typeof knowledgeMetaSchema>): { [key: string]: Json } {
  return {
    title: m.title,
    title_ar: m.titleAr ?? '',
    description: m.description ?? '',
    language: m.language,
    department_id: m.departmentId ?? '',
    category: m.category ?? '',
    visibility: m.visibility,
    is_authoritative: m.isAuthoritative,
    source_priority: m.sourcePriority,
    effective_date: m.effectiveDate ?? '',
    expiry_date: m.expiryDate ?? '',
    source_url: m.sourceUrl ?? '',
    access_department_ids: m.visibility === 'restricted' ? m.accessDepartmentIds : [],
    access_role_ids: m.visibility === 'restricted' ? m.accessRoleIds : [],
  }
}
