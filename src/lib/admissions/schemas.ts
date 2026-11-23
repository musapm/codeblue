import { z } from 'zod'

/** Validation for staff admissions forms (pure; mirrors the database constraints). */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'nameTooLong' })
    .optional()
    .transform((v) => (v ? v : null))

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.enum(values, { error: 'invalidValue' }).nullable())

export const PROGRAM_LEVELS = ['certificate', 'diploma', 'bachelor', 'master', 'doctorate', 'other'] as const
export const STUDY_MODES = ['full_time', 'part_time', 'online', 'blended'] as const
export const TEACHING_LANGUAGES = ['en', 'ar', 'mixed'] as const
export const TUITION_PERIODS = ['year', 'semester', 'credit_hour', 'total'] as const
export const PROGRAM_STATUSES = ['draft', 'published', 'archived'] as const
export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'applied', 'admitted', 'enrolled', 'lost'] as const

const optionalNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number({ error: 'numberInvalid' }).min(min, { error: 'numberInvalid' }).max(max, { error: 'numberInvalid' }).nullable())

const optionalHttps = z
  .string()
  .trim()
  .max(500, { error: 'urlInvalid' })
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.url({ protocol: /^https$/, error: 'urlInvalid' }).nullable())

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.iso.date({ error: 'dateInvalid' }).nullable())

export const programSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, { error: 'codeInvalid' }),
    name: z.string().trim().min(2, { error: 'nameRequired' }).max(160, { error: 'nameTooLong' }),
    nameAr: optional(160),
    level: z.enum(PROGRAM_LEVELS, { error: 'invalidValue' }),
    departmentId: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid({ error: 'invalidValue' }).nullable()),
    description: optional(4000),
    descriptionAr: optional(4000),
    requirements: optional(4000),
    requirementsAr: optional(4000),
    durationMonths: optionalNumber(1, 120).refine((v) => v === null || Number.isInteger(v), { error: 'numberInvalid' }),
    studyMode: optionalEnum(STUDY_MODES),
    teachingLanguage: optionalEnum(TEACHING_LANGUAGES),
    intakes: optional(200),
    intakesAr: optional(200),
    tuitionAmount: optionalNumber(0, 10_000_000),
    tuitionCurrency: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null))
      .pipe(z.string().regex(/^[A-Z]{3}$/, { error: 'currencyInvalid' }).nullable()),
    tuitionPeriod: optionalEnum(TUITION_PERIODS),
    tuitionNote: optional(500),
    tuitionNoteAr: optional(500),
    applicationDeadline: optionalDate,
    applicationUrl: optionalHttps,
    sortOrder: optionalNumber(-1000, 1000)
      .refine((v) => v === null || Number.isInteger(v), { error: 'numberInvalid' })
      .transform((v) => v ?? 0),
  })
  .refine((v) => v.tuitionAmount === null || (v.tuitionCurrency !== null && v.tuitionPeriod !== null), {
    path: ['tuitionAmount'],
    error: 'tuitionIncomplete',
  })

export type ProgramInput = z.infer<typeof programSchema>

/** Form values → database columns. */
export function toProgramRow(p: ProgramInput) {
  return {
    code: p.code,
    name: p.name,
    name_ar: p.nameAr,
    level: p.level,
    department_id: p.departmentId,
    description: p.description,
    description_ar: p.descriptionAr,
    requirements: p.requirements,
    requirements_ar: p.requirementsAr,
    duration_months: p.durationMonths,
    study_mode: p.studyMode,
    teaching_language: p.teachingLanguage,
    intakes: p.intakes,
    intakes_ar: p.intakesAr,
    tuition_amount: p.tuitionAmount,
    tuition_currency: p.tuitionAmount === null ? null : p.tuitionCurrency,
    tuition_period: p.tuitionAmount === null ? null : p.tuitionPeriod,
    tuition_note: p.tuitionNote,
    tuition_note_ar: p.tuitionNoteAr,
    application_deadline: p.applicationDeadline,
    application_url: p.applicationUrl,
    sort_order: p.sortOrder,
  }
}

export const manualLeadSchema = z
  .object({
    fullName: z.string({ error: 'nameRequired' }).trim().min(2, { error: 'nameRequired' }).max(120, { error: 'nameTooLong' }),
    email: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toLowerCase() : null))
      .pipe(z.email({ error: 'emailInvalid' }).max(254, { error: 'emailInvalid' }).nullable()),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.string().regex(/^[+]?[0-9 ()-]{6,32}$/, { error: 'phoneInvalid' }).nullable()),
    country: optional(80),
    programId: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid({ error: 'invalidValue' }).nullable()),
    intake: optional(60),
    message: optional(2000),
    locale: z.enum(['en', 'ar']).catch('en'),
    consentNote: z.string({ error: 'consentNoteRequired' }).trim().min(10, { error: 'consentNoteRequired' }).max(2000, { error: 'nameTooLong' }),
  })
  .refine((v) => v.email || v.phone, { path: ['email'], error: 'contactRequired' })

export const leadUpdateSchema = z.object({
  leadId: z.uuid(),
  stage: z.enum(LEAD_STAGES, { error: 'invalidValue' }),
  lostReason: optional(300),
  assignedTo: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid({ error: 'invalidValue' }).nullable()),
  programId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid({ error: 'invalidValue' }).nullable()),
})

/** Lead search text for PostgREST filters: keep letters, digits, @ . + - and spaces only. */
export function sanitizeLeadSearch(q: string | undefined | null): string | null {
  const cleaned = (q ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}@.+\- ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned.length >= 2 ? cleaned : null
}
