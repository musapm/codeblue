import { z } from 'zod'

/** Staff assistant (Phase 10): constants, form schemas, stored shapes and pure helpers. */

export const DRAFT_KINDS = ['email', 'letter', 'announcement'] as const
export type DraftKind = (typeof DRAFT_KINDS)[number]
export const TONES = ['formal', 'friendly'] as const
export const DIGEST_SCOPES = ['mine', 'department', 'all'] as const
export type DigestScope = (typeof DIGEST_SCOPES)[number]

const optionalUuid = z
  .string()
  .optional()
  .transform((s) => (s ? s : null))
  .pipe(z.uuid().nullable())
/** An HTML checkbox: 'on' when ticked, absent otherwise. */
const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('')])
  .optional()
  .transform((v) => v === 'on' || v === 'true')

export const draftSchema = z.object({
  kind: z.enum(DRAFT_KINDS),
  audience: z.string().trim().min(2, 'audienceRequired').max(200, 'nameTooLong'),
  purpose: z.string().trim().min(10, 'purposeRequired').max(3000, 'purposeTooLong'),
  tone: z.enum(TONES).default('formal'),
  language: z.enum(['en', 'ar']),
  departmentId: optionalUuid,
  useDocuments: checkbox,
})
export type DraftInput = z.infer<typeof draftSchema>

export const digestSchema = z
  .object({ scope: z.enum(DIGEST_SCOPES), departmentId: optionalUuid, language: z.enum(['en', 'ar']) })
  // A department narrows only the "my departments" view.
  .transform((v) => ({ ...v, departmentId: v.scope === 'department' ? v.departmentId : null }))

export const staffSettingsSchema = z.object({
  enabled: checkbox,
  instructions: z
    .string()
    .trim()
    .max(2000, 'messageTooLong')
    .optional()
    .transform((s) => (s ? s : null)),
  monthlyBudget: z.coerce.number('budgetInvalid').min(0, 'budgetInvalid').max(100000, 'budgetInvalid'),
  dailyLimit: z.coerce.number('dailyLimitInvalid').int('dailyLimitInvalid').min(1, 'dailyLimitInvalid').max(500, 'dailyLimitInvalid'),
})

export const DraftContent = z.object({
  subject: z.string().nullable().catch(null),
  body: z.string(),
  missing: z.array(z.string()).catch([]),
})
export type DraftContent = z.infer<typeof DraftContent>

export const DraftSources = z
  .array(z.object({ document_id: z.string(), version_no: z.number().nullable().catch(null), title: z.string(), title_ar: z.string().nullable().catch(null) }))
  .catch([])

export type Digest = {
  overview: string
  themes: { title: string; summary: string; tickets: { id: string; reference: string }[] }[]
  attention: { id: string; reference: string; reason: string }[]
  suggestions: string[]
}

/** A date (kept) or a run of digits with phone-number punctuation (checked). */
const NUMBERISH =
  /([0-9٠-٩۰-۹]{4}[-/.][0-9٠-٩۰-۹]{1,2}[-/.][0-9٠-٩۰-۹]{1,2}|[0-9٠-٩۰-۹]{1,2}[-/.][0-9٠-٩۰-۹]{1,2}[-/.][0-9٠-٩۰-۹]{2,4})|\+?[0-9٠-٩۰-۹][0-9٠-٩۰-۹ ().-]{6,}[0-9٠-٩۰-۹]/g

/**
 * Data minimization for ticket text sent to the model: e-mail addresses and numbers of 8 or more
 * digits (phone numbers, student or national ids) are replaced; dates and short numbers are kept.
 * Best effort: it is not a guarantee that no personal data remains.
 */
export function redactContact(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(NUMBERISH, (match: string, date: string | undefined) =>
      !date && match.replace(/[^0-9٠-٩۰-۹]/g, '').length >= 8 ? '[number]' : match,
    )
}
