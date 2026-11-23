import { z } from 'zod'

/**
 * Shapes of the analytics and AI-quality functions (migration 14) and the pure helpers the
 * pages use. Every number shown comes from these payloads; nothing here estimates or fills in.
 */

export const PERIODS = [7, 30, 90] as const
export type Period = (typeof PERIODS)[number]
export const AGENTS = ['student', 'admissions'] as const
export type Agent = (typeof AGENTS)[number]
export const OUTCOMES = ['correct', 'knowledge_added', 'knowledge_needed', 'assistant_error', 'out_of_scope'] as const
export type Outcome = (typeof OUTCOMES)[number]
export const QUALITY_TABS = ['gaps', 'negative', 'refused'] as const
export type QualityTab = (typeof QUALITY_TABS)[number]

/** The period from a search parameter: 7 or 30 days; 90 only with advanced analytics. */
export function parsePeriod(value: unknown, opts: { advanced: boolean; fallback?: Period }): Period {
  const n = Number(typeof value === 'string' ? value : NaN)
  const fallback = opts.fallback ?? 30
  if (n === 7 || n === 30) return n
  if (n === 90) return opts.advanced ? 90 : fallback
  return fallback
}

export function parseChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && (choices as readonly string[]).includes(value) ? (value as T) : fallback
}

/** part / whole, or null when there is nothing to divide (never a made-up 0 %). */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

/** Budget meter state: under 80 % normal, then warning, at or over the budget "over". */
export function budgetLevel(spent: number, budget: number | null): 'normal' | 'warning' | 'over' | 'none' {
  if (budget === null || budget <= 0) return 'none'
  const r = spent / budget
  return r >= 1 ? 'over' : r >= 0.8 ? 'warning' : 'normal'
}

const num = z.number().catch(0)
const nullableNum = z.number().nullable().catch(null)

const AssistantStats = z.object({
  questions: num,
  answered: num,
  no_sources: num,
  refused: num,
  errors: num,
  people: num,
  helpful: num,
  not_helpful: num,
  median_latency_ms: nullableNum,
  series: z.array(z.object({ start: z.string(), questions: num, answered: num, gaps: num })).catch([]),
})
export type AssistantStats = z.infer<typeof AssistantStats>

const QualityCounts = z.object({
  gaps_open: num,
  negative_open: num,
  refused_open: num,
  reviewed: num,
  outcomes: z.record(z.string(), num).catch({}),
})
export type QualityCounts = z.infer<typeof QualityCounts>

export const OverviewSchema = z.object({
  period: z.object({
    days: z.number(),
    from: z.string(),
    to: z.string(),
    since: z.string(),
    timezone: z.string(),
    bucket: z.enum(['day', 'week']),
  }),
  generated_at: z.string(),
  members: z.object({ active: num }),
  assistant: z.object({ student: AssistantStats.optional(), admissions: AssistantStats.optional() }).nullable(),
  tickets: z
    .object({
      created: num,
      from_assistant: num,
      resolved: num,
      open_now: num,
      open_by_status: z.object({ open: num, in_progress: num, waiting: num }),
      unassigned_now: num,
      awaiting_first_response: num,
      median_first_response_minutes: nullableNum,
      median_resolution_hours: nullableNum,
      by_department: z.array(z.object({ id: z.string().nullable(), name: z.string().nullable(), name_ar: z.string().nullable(), open: num, created: num })).catch([]),
      by_category: z.array(z.object({ id: z.string().nullable(), name: z.string().nullable(), name_ar: z.string().nullable(), created: num })).catch([]),
      series: z.array(z.object({ start: z.string(), created: num, resolved: num })).catch([]),
    })
    .nullable(),
  admissions: z.object({ leads: num, by_source: z.object({ form: num, assistant: num, manual: num }) }).nullable(),
  knowledge: z
    .object({
      published: num,
      expired: num,
      unpublished: num,
      top_cited: z.array(z.object({ id: z.string(), title: z.string(), title_ar: z.string().nullable(), answers: num })).catch([]),
    })
    .nullable(),
  ai: z
    .object({
      month_since: z.string(),
      month: z.object({ student_assistant: num, admissions_agent: num, ticketing: num }),
      budgets: z.object({ student_assistant: nullableNum, admissions_agent: nullableNum }),
      period: z.object({ calls: num, cost_usd: num, input_tokens: num, output_tokens: num }),
    })
    .nullable(),
  quality: QualityCounts.nullable(),
  can: z.object({ costs: z.boolean(), gaps: z.boolean(), review: z.boolean(), advanced: z.boolean() }),
})
export type Overview = z.infer<typeof OverviewSchema>

const ReviewSchema = z.object({ outcome: z.enum(OUTCOMES), note: z.string().nullable(), reviewer: z.string(), at: z.string() })
export type Review = z.infer<typeof ReviewSchema>

export const GapSchema = z.object({
  question: z.string(),
  count: num,
  open: num,
  first_at: z.string(),
  last_at: z.string(),
  agents: z.array(z.enum(AGENTS)).catch([]),
  open_ids: z.array(z.uuid()).catch([]),
  reviewed_ids: z.array(z.uuid()).catch([]),
  review: ReviewSchema.nullable().catch(null),
})
export type Gap = z.infer<typeof GapSchema>

export const FlaggedSchema = z.object({
  id: z.uuid(),
  agent: z.enum(AGENTS),
  status: z.string(),
  answered_at: z.string(),
  rated_at: z.string().nullable(),
  question: z.string().nullable(),
  comment: z.string().nullable(),
  visible: z.boolean(),
  answer: z.string().nullable(),
  citations: z
    .array(
      z.object({
        n: nullableNum,
        title: z.string().nullable().catch(null),
        page_from: nullableNum,
        page_to: nullableNum,
        text: z.string().nullable().catch(null),
        program: z.boolean().catch(false),
      }),
    )
    .catch([]),
  review: ReviewSchema.nullable().catch(null),
})
export type Flagged = z.infer<typeof FlaggedSchema>

export { QualityCounts as QualityCountsSchema }

/** Server action input: one or more flagged answers (a group of identical questions at once). */
export const reviewSchema = z.object({
  messageIds: z
    .string()
    .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])
    .pipe(z.array(z.uuid()).min(1).max(200)),
  outcome: z.enum(OUTCOMES),
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .default(null),
})
