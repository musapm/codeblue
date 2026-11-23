import { z } from 'zod'

/** Academic assistant (Phase 9): constants, form schemas, stored study-aid shapes, pure helpers. */

export const STUDY_KINDS = ['summary', 'quiz', 'flashcards', 'study_plan'] as const
export type StudyKind = (typeof STUDY_KINDS)[number]
export const COURSE_STATUSES = ['draft', 'active', 'archived'] as const
export type CourseStatus = (typeof COURSE_STATUSES)[number]
export const MAX_MATERIALS = 10
export const QUIZ_SIZES = [5, 10, 15] as const
export const CARD_SIZES = [10, 20, 30] as const

const uuid = z.uuid()
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'nameTooLong')
    .optional()
    .transform((s) => (s ? s : null))
const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal(''), z.undefined()])
  .transform((v) => v === 'on' || v === 'true')

export const courseSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/, 'courseCode'),
  title: z.string().trim().min(2, 'nameRequired').max(160, 'nameTooLong'),
  titleAr: optionalText(160),
  description: optionalText(2000),
  term: optionalText(40),
  departmentId: z
    .string()
    .optional()
    .transform((s) => (s ? s : null))
    .pipe(uuid.nullable()),
  status: z.enum(COURSE_STATUSES).default('draft'),
})

export const courseAiSchema = z.object({
  courseId: uuid,
  aiEnabled: checkbox,
  allowSummaries: checkbox,
  allowQuizzes: checkbox,
  allowFlashcards: checkbox,
  allowStudyPlans: checkbox,
  instructions: optionalText(1000),
})

export const joinSchema = z.object({ code: z.string().trim().min(6, 'joinCode').max(20, 'joinCode') })
export const instructorSchema = z.object({ courseId: uuid, email: z.email('emailInvalid').trim() })
export const academicSettingsSchema = z.object({
  monthlyBudget: z.coerce.number('invalidValue').min(0, 'invalidValue').max(100000, 'invalidValue'),
  dailyLimit: z.coerce.number('invalidValue').int('invalidValue').min(1, 'invalidValue').max(200, 'invalidValue'),
})

/** The study-tool form. Options apply to the kind chosen. */
export const generateSchema = z
  .object({
    courseId: uuid,
    kind: z.enum(STUDY_KINDS),
    documentIds: z.array(uuid).min(1, 'chooseMaterials').max(MAX_MATERIALS, 'chooseMaterials'),
    count: z.coerce.number().int().min(5).max(30).default(10),
    examDate: z
      .string()
      .optional()
      .transform((s) => (s ? s : null))
      .pipe(z.iso.date('invalidValue').nullable()),
    perWeek: z.coerce.number().int().min(1).max(7).default(3),
    minutes: z.coerce.number().int().min(15).max(240).default(45),
    language: z.enum(['en', 'ar']),
  })
  .transform((v) => ({ ...v, documentIds: [...new Set(v.documentIds)] }))
export type GenerateInput = z.infer<typeof generateSchema>

// ---------------------------------------------------------------------------
// Stored study aids (read back for display; tolerant of older shapes)
// ---------------------------------------------------------------------------

/** A reference to the material an item came from: index into the item's sources (0-based). */
export const SourceRef = z.object({ m: z.number().int().nonnegative(), pages: z.string().nullable().catch(null) }).nullable().catch(null)
export type SourceRef = z.infer<typeof SourceRef>

export const ItemSources = z
  .array(z.object({ document_id: z.string(), version_no: z.number().nullable().catch(null), title: z.string(), title_ar: z.string().nullable().catch(null) }))
  .catch([])
export type ItemSource = z.infer<typeof ItemSources>[number]

export const SummaryContent = z.object({
  overview: z.string(),
  key_points: z.array(z.object({ text: z.string(), source: SourceRef })).catch([]),
  terms: z.array(z.object({ term: z.string(), definition: z.string(), source: SourceRef })).catch([]),
})
export const QuizContent = z.object({
  questions: z.array(z.object({ question: z.string(), options: z.array(z.string()), source: SourceRef })),
})
export const FlashcardsContent = z.object({
  cards: z.array(z.object({ front: z.string(), back: z.string(), source: SourceRef })),
})
export const PlanContent = z.object({
  exam_date: z.string().nullable().catch(null),
  sessions: z.array(
    z.object({
      date: z.string(),
      minutes: z.number(),
      focus: z.string(),
      activities: z.array(z.string()).catch([]),
      sources: z.array(SourceRef).catch([]),
    }),
  ),
})
export type SummaryContent = z.infer<typeof SummaryContent>
export type QuizContent = z.infer<typeof QuizContent>
export type FlashcardsContent = z.infer<typeof FlashcardsContent>
export type PlanContent = z.infer<typeof PlanContent>

export const QuizResult = z.object({
  score: z.number(),
  total: z.number(),
  attempts: z.number().optional(),
  results: z.array(
    z.object({
      correct: z.boolean().catch(false),
      given: z.number().nullable().catch(null),
      answer: z.number(),
      explanation: z.string().nullable().catch(null),
    }),
  ),
})
export type QuizResult = z.infer<typeof QuizResult>

/** Indexes saved as progress ({"known": […]} or {"done": […]}), ignoring anything malformed. */
export function progressIndexes(state: unknown, key: 'known' | 'done', count: number): number[] {
  const list = (state as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count))].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Study plan dates
// ---------------------------------------------------------------------------

const DAY = 86_400_000
const toDay = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const fromDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * Session dates for a study plan: from tomorrow until the day before the exam (or four weeks
 * without one), `perWeek` sessions in each 7-day window, spread out. At most `max` sessions;
 * when there are more, the ones closest to the exam are kept.
 */
export function planSlots(opts: { today: string; examDate: string | null; perWeek: number; minutes: number; max?: number }): { date: string; minutes: number }[] {
  const start = toDay(opts.today) + DAY
  const end = opts.examDate ? toDay(opts.examDate) - DAY : start + 27 * DAY
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const perWeek = Math.min(7, Math.max(1, Math.trunc(opts.perWeek)))
  const slots: { date: string; minutes: number }[] = []
  for (let windowStart = start; windowStart <= end; windowStart += 7 * DAY) {
    const length = Math.min(7, Math.round((end - windowStart) / DAY) + 1)
    const picks = Math.min(perWeek, length)
    const offsets = new Set(Array.from({ length: picks }, (_, k) => Math.floor(((k + 0.5) * length) / picks)))
    for (const offset of [...offsets].sort((a, b) => a - b)) slots.push({ date: fromDay(windowStart + offset * DAY), minutes: opts.minutes })
  }
  return slots.slice(-(opts.max ?? 30))
}
