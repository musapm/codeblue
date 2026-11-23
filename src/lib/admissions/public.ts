import { z } from 'zod'
import type { RetrievedChunk } from '@/lib/ai/prompt'

/**
 * Public admissions data (pure, client-safe): the payload of public_admissions(), program
 * records turned into citable passages for the admissions assistant, program selection for a
 * question, and the consent wording shown on the inquiry form.
 */

const text = z.string().nullable().catch(null)

export const publicProgramSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  name_ar: text,
  level: z.string(),
  department: text,
  department_ar: text,
  description: text,
  description_ar: text,
  requirements: text,
  requirements_ar: text,
  duration_months: z.number().nullable().catch(null),
  study_mode: text,
  teaching_language: text,
  intakes: text,
  intakes_ar: text,
  tuition_amount: z.coerce.number().nullable().catch(null),
  tuition_currency: text,
  tuition_period: text,
  tuition_note: text,
  tuition_note_ar: text,
  application_deadline: text,
  application_url: text,
  updated_at: z.string().catch(''),
})

export type PublicProgram = z.infer<typeof publicProgramSchema>

export const publicAdmissionsSchema = z.object({
  tenant: z.object({
    slug: z.string(),
    name: z.string(),
    name_translations: z.record(z.string(), z.string()).catch({}),
    default_locale: z.enum(['en', 'ar']).catch('en'),
  }),
  branding: z.record(z.string(), z.unknown()).catch({}),
  settings: z.object({
    assistant_enabled: z.boolean().catch(false),
    contact_email: text,
    privacy_url: text,
    welcome: text,
    welcome_ar: text,
    consent_text: text,
    consent_text_ar: text,
    consent_version: z.number().catch(1),
  }),
  programs: z.array(publicProgramSchema).catch([]),
})

export type PublicAdmissions = z.infer<typeof publicAdmissionsSchema>

/** Localized value: Arabic when asked for and present, otherwise the English value. */
export function pick(locale: string, en: string | null | undefined, ar: string | null | undefined): string | null {
  return (locale === 'ar' && ar?.trim()) || en?.trim() || null
}

const LEVEL_EN: Record<string, string> = {
  certificate: 'Certificate',
  diploma: 'Diploma',
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  doctorate: 'Doctorate',
  other: 'Other',
}
const MODE_EN: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', online: 'Online', blended: 'Blended' }
const LANGUAGE_EN: Record<string, string> = { en: 'English', ar: 'Arabic', mixed: 'Arabic and English' }
const PERIOD_EN: Record<string, string> = { year: 'per year', semester: 'per semester', credit_hour: 'per credit hour', total: 'in total' }

/** Tuition as a plain sentence for the model (amounts stay exactly as stored). */
export function tuitionText(p: Pick<PublicProgram, 'tuition_amount' | 'tuition_currency' | 'tuition_period'>): string | null {
  if (p.tuition_amount == null || !p.tuition_currency || !p.tuition_period) return null
  return `${p.tuition_amount} ${p.tuition_currency} ${PERIOD_EN[p.tuition_period] ?? p.tuition_period}`
}

/**
 * A program record as a citable passage. All facts come from the record; English and Arabic
 * wording are both included so the model can answer in the visitor's language.
 */
export function programToChunk(p: PublicProgram, index: number): RetrievedChunk {
  const lines = [
    `Program: ${p.name} (code ${p.code})`,
    p.name_ar ? `Arabic name: ${p.name_ar}` : null,
    `Level: ${LEVEL_EN[p.level] ?? p.level}`,
    p.department ? `Department: ${p.department}${p.department_ar ? ` / ${p.department_ar}` : ''}` : null,
    p.duration_months ? `Duration: ${p.duration_months} months` : null,
    p.study_mode ? `Study mode: ${MODE_EN[p.study_mode] ?? p.study_mode}` : null,
    p.teaching_language ? `Language of instruction: ${LANGUAGE_EN[p.teaching_language] ?? p.teaching_language}` : null,
    p.intakes ? `Intakes: ${p.intakes}` : null,
    p.intakes_ar ? `Intakes (Arabic): ${p.intakes_ar}` : null,
    tuitionText(p) ? `Tuition: ${tuitionText(p)}` : null,
    p.tuition_note ? `Tuition note: ${p.tuition_note}` : null,
    p.tuition_note_ar ? `Tuition note (Arabic): ${p.tuition_note_ar}` : null,
    p.application_deadline ? `Application deadline: ${p.application_deadline}` : null,
    p.application_url ? `How to apply: ${p.application_url}` : null,
    p.requirements ? `Admission requirements:\n${p.requirements}` : null,
    p.requirements_ar ? `Admission requirements (Arabic):\n${p.requirements_ar}` : null,
    p.description ? `About the program:\n${p.description}` : null,
    p.description_ar ? `About the program (Arabic):\n${p.description_ar}` : null,
  ].filter(Boolean)
  return {
    // Programs are not knowledge chunks: negative ids keep them apart from stored chunks.
    chunk_id: -(index + 1),
    document_id: '',
    version_no: 0,
    title: p.name,
    title_ar: p.name_ar,
    page_from: null,
    page_to: null,
    heading: null,
    content: lines.join('\n'),
    score: 0,
    program_id: p.id,
    program_code: p.code,
  }
}

const WORD = /[\p{L}\p{N}]{3,}/gu

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(WORD) ?? []).map((w) => w.replace(/^ال/, '')))
}

/**
 * Programs to give the model for one question: all of them when there are few; otherwise
 * the ones whose name, code, department or description share words with the question (then
 * the catalogue order). Keeps prompts small without hiding a program the visitor named.
 */
export function selectPrograms(question: string, programs: PublicProgram[], max = 8): PublicProgram[] {
  if (programs.length <= max) return programs
  const q = words(question)
  const scored = programs.map((p, i) => {
    const hay = words([p.name, p.name_ar, p.code, p.department, p.department_ar, p.description, p.description_ar].filter(Boolean).join(' '))
    let score = 0
    for (const w of q) if (hay.has(w)) score++
    return { p, i, score }
  })
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .map((s) => s.p)
}

/**
 * The consent wording shown on the inquiry form and its version. A university's own wording
 * is versioned by the database; otherwise the platform default applies ("default-1").
 */
export function consentFor(page: PublicAdmissions, locale: string, platformDefault: string): { text: string; version: string } {
  const own = pick(locale, page.settings.consent_text, page.settings.consent_text_ar)
  if (own) return { text: own, version: String(page.settings.consent_version) }
  return { text: platformDefault, version: 'default-1' }
}
