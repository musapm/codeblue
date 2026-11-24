import { z } from 'zod'

/**
 * Service request workflows (Phase 11): field and status rules shared by the server and the
 * browser. The database (app.workflow_fields_valid, app.workflow_answers_clean,
 * app.workflow_next_allowed) is the authority; these mirror it for immediate feedback.
 */

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const REQUEST_STATUSES = ['submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'completed', 'cancelled'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
export const OPEN_STATUSES: readonly RequestStatus[] = ['submitted', 'in_review', 'needs_info', 'approved']
export const FINAL_STATUSES: readonly RequestStatus[] = ['rejected', 'completed', 'cancelled']
/** Requesters may cancel while nothing is decided. */
export const CANCELLABLE: readonly RequestStatus[] = ['submitted', 'in_review', 'needs_info']
/** The status flow (app.workflow_next_allowed). */
export const NEXT_STATUSES: Record<RequestStatus, readonly RequestStatus[]> = {
  submitted: ['in_review', 'needs_info', 'approved', 'rejected', 'completed'],
  in_review: ['needs_info', 'approved', 'rejected', 'completed'],
  needs_info: ['in_review', 'approved', 'rejected'],
  approved: ['completed'],
  rejected: [],
  completed: [],
  cancelled: [],
}
/** These steps need a message for the requester. */
export const MESSAGE_REQUIRED: readonly RequestStatus[] = ['needs_info', 'rejected']

export const asStatus = (s: string): RequestStatus => ((REQUEST_STATUSES as readonly string[]).includes(s) ? (s as RequestStatus) : 'submitted')

export type FieldOption = { value: string; label: string; label_ar?: string | null }
export type FormField = {
  key: string
  type: FieldType
  label: string
  label_ar?: string | null
  help?: string | null
  help_ar?: string | null
  required: boolean
  options?: FieldOption[] | null
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/
const OPTION_VALUE = /^[a-z0-9][a-z0-9_-]{0,39}$/
const optionalText = (max: number) => z.string().max(max).nullish()

const OptionSchema = z.strictObject({ value: z.string().regex(OPTION_VALUE), label: z.string().trim().min(1).max(120), label_ar: optionalText(120) })
export const FieldSchema = z
  .strictObject({
    key: z.string().regex(KEY),
    type: z.enum(FIELD_TYPES),
    label: z.string().trim().min(1).max(200),
    label_ar: optionalText(200),
    help: optionalText(500),
    help_ar: optionalText(500),
    required: z.boolean(),
    options: z.array(OptionSchema).min(1).max(30).nullish(),
  })
  .refine((f) => (f.type === 'select' ? !!f.options : !f.options), { message: 'options' })
  .refine((f) => !f.options || new Set(f.options.map((o) => o.value)).size === f.options.length, { message: 'options' })

/** A form's fields as stored (same rules as app.workflow_fields_valid). */
export const FieldsSchema = z
  .array(FieldSchema)
  .min(1)
  .max(30)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, { message: 'keys' })

/** Stored fields, read leniently: a malformed form shows no fields rather than crashing. */
export function readFields(value: unknown): FormField[] {
  const parsed = FieldsSchema.safeParse(value)
  return parsed.success ? (parsed.data as FormField[]) : []
}

export type AnswerValue = string | number | boolean
export type AnswerProblem = 'required' | 'invalid'

const NUMBER = /^-?[0-9]{1,12}(\.[0-9]{1,4})?$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function validDate(text: string): boolean {
  if (!DATE.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  const year = Number(text.slice(0, 4))
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text && year >= 1900 && year <= 2100
}

/** Check one value (not the required rule); returns the cleaned value or null when invalid. */
export function cleanValue(field: FormField, raw: unknown): AnswerValue | null {
  if (field.type === 'checkbox') return raw === true || raw === 'true' || raw === 'on'
  if (typeof raw === 'number' && field.type === 'number') raw = String(raw)
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  switch (field.type) {
    case 'number':
      return NUMBER.test(text) ? text : null
    case 'text':
      return text.length <= 200 ? text : null
    case 'textarea':
      return text.length <= 4000 ? text : null
    case 'email':
      return text.length <= 254 && EMAIL.test(text) ? text : null
    case 'date':
      return validDate(text) ? text : null
    case 'select':
      return field.options?.some((o) => o.value === text) ? text : null
  }
}

/** Same rules as app.workflow_answers_clean. Empty optional answers are left out. */
export function checkAnswers(
  fields: FormField[],
  raw: Record<string, unknown>,
): { ok: true; answers: Record<string, AnswerValue> } | { ok: false; problems: Record<string, AnswerProblem> } {
  const answers: Record<string, AnswerValue> = {}
  const problems: Record<string, AnswerProblem> = {}
  for (const field of fields) {
    const value = raw[field.key]
    if (field.type === 'checkbox') {
      const ticked = cleanValue(field, value) === true
      if (field.required && !ticked) problems[field.key] = 'required'
      answers[field.key] = ticked
      continue
    }
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (field.required) problems[field.key] = 'required'
      continue
    }
    const cleaned = cleanValue(field, value)
    if (cleaned === null) problems[field.key] = 'invalid'
    else answers[field.key] = cleaned
  }
  return Object.keys(problems).length ? { ok: false, problems } : { ok: true, answers }
}

export const localized = (locale: string, en: string, ar?: string | null) => (locale === 'ar' && ar ? ar : en)
export const fieldLabel = (locale: string, f: FormField) => localized(locale, f.label, f.label_ar)
export const fieldHelp = (locale: string, f: FormField) => (f.help ? localized(locale, f.help, f.help_ar) : (locale === 'ar' && f.help_ar) || null)

/** An answer as text for the request page. */
export function formatAnswer(locale: string, field: FormField, value: unknown, yesNo: { yes: string; no: string }): string {
  if (value === undefined || value === null || value === '') return ''
  if (field.type === 'checkbox') return value === true ? yesNo.yes : yesNo.no
  if (field.type === 'select') {
    const option = field.options?.find((o) => o.value === value)
    return option ? localized(locale, option.label, option.label_ar) : String(value)
  }
  if (field.type === 'date' && typeof value === 'string' && validDate(value)) {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
  }
  if (field.type === 'number') return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(Number(value))
  return String(value)
}

// ---------------------------------------------------------------------------
// Field builder helpers
// ---------------------------------------------------------------------------

/** A field key from a label: lower-case ASCII letters, digits and underscores. */
export function keyFromLabel(label: string, taken: ReadonlySet<string>, fallback = 'field'): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 32) || fallback
  let key = base
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 36)}_${i}`
  return key
}

/** Options typed one per line as "English label | Arabic label" (values are derived and stable). */
export function parseOptionLines(text: string, previous: FieldOption[] = []): FieldOption[] {
  const taken = new Set<string>()
  return text
    .split('\n')
    .map((line) => line.split('|').map((p) => p.trim()))
    .filter(([label]) => !!label)
    .slice(0, 30)
    .map(([label, labelAr]) => {
      const kept = previous.find((o) => o.label === label && !taken.has(o.value))
      const value = kept?.value ?? keyFromLabel(label!, taken, 'option').replace(/_/g, '-').slice(0, 40)
      taken.add(value)
      return { value, label: label!.slice(0, 120), label_ar: labelAr ? labelAr.slice(0, 120) : null }
    })
}

export const optionLines = (options: FieldOption[] | null | undefined) => (options ?? []).map((o) => (o.label_ar ? `${o.label} | ${o.label_ar}` : o.label)).join('\n')

// ---------------------------------------------------------------------------
// Form input schemas (Server Actions)
// ---------------------------------------------------------------------------

const optionalTrim = (max: number, key: 'messageTooLong' | 'nameTooLong' = 'nameTooLong') =>
  z
    .string()
    .trim()
    .max(max, key)
    .optional()
    .transform((s) => (s ? s : null))
const optionalUuid = z
  .string()
  .optional()
  .transform((s) => (s ? s : null))
  .pipe(z.uuid().nullable())
const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('')])
  .optional()
  .transform((v) => v === 'on' || v === 'true')

export const definitionSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,47}$/, 'workflowKey'),
  title: z.string().trim().min(2, 'nameRequired').max(160, 'nameTooLong'),
  titleAr: optionalTrim(160),
  description: optionalTrim(1000, 'messageTooLong'),
  descriptionAr: optionalTrim(1000, 'messageTooLong'),
  departmentId: optionalUuid,
})

/** The fields arrive as JSON from the builder; parseFieldsJson checks them. */
export const versionSchema = z.object({
  fields: z.string().max(200_000, 'workflowFields'),
  instructions: optionalTrim(2000, 'messageTooLong'),
  instructionsAr: optionalTrim(2000, 'messageTooLong'),
  confirmation: optionalTrim(1000, 'messageTooLong'),
  confirmationAr: optionalTrim(1000, 'messageTooLong'),
})

export function parseFieldsJson(text: string): FormField[] | null {
  try {
    const parsed = FieldsSchema.safeParse(JSON.parse(text))
    return parsed.success ? (parsed.data as FormField[]) : null
  } catch {
    return null
  }
}

export const workflowSettingsSchema = z.object({
  aiEnabled: checkbox,
  monthlyBudget: z.coerce.number('budgetInvalid').min(0, 'budgetInvalid').max(100000, 'budgetInvalid'),
  dailyLimit: z.coerce.number('dailyLimitWorkflow').int('dailyLimitWorkflow').min(1, 'dailyLimitWorkflow').max(200, 'dailyLimitWorkflow'),
})

export const statusUpdateSchema = z
  .object({
    requestId: z.uuid(),
    status: z.enum(REQUEST_STATUSES),
    message: optionalTrim(4000, 'messageTooLong'),
  })
  .refine((v) => !MESSAGE_REQUIRED.includes(v.status) || (v.message?.length ?? 0) >= 3, { path: ['message'], message: 'workflowMessageRequired' })

export const commentSchema = z.object({
  requestId: z.uuid(),
  body: z.string().trim().min(1, 'messageRequired').max(4000, 'messageTooLong'),
  internal: checkbox,
})

export const suggestSchema = z.object({
  text: z.string().trim().min(10, 'workflowDescribe').max(2000, 'messageTooLong'),
})
