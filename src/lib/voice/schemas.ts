import { z } from 'zod'

/**
 * Voice (Phase 13): shared, client-safe rules. Speech input fills the message box (the person
 * still presses send); read-aloud speaks an answer. Providers: 'browser' (the browser's own
 * speech features) or 'server' (a contracted speech provider behind SpeechProvider).
 */

export const VOICE_PROVIDERS = ['browser', 'server'] as const
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number]
export const VOICE_SURFACES = ['student_chat', 'staff_chat'] as const
export type VoiceSurface = (typeof VOICE_SURFACES)[number]

/** Speech-recognition and voice language tags for the interface languages. */
export const speechLang = (locale: string) => (locale === 'ar' ? 'ar-SA' : 'en-US')

/** An answer as plain text for reading aloud: no [n] markers, list dashes or extra spaces. */
export function speakableText(text: string, max = 4000): string {
  return text
    .replace(/\[\d{1,2}\]/g, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, max)
}

const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('')])
  .optional()
  .transform((v) => v === 'on' || v === 'true')
const optionalPrice = z
  .string()
  .trim()
  .optional()
  .transform((s, ctx) => {
    if (!s) return null
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      ctx.addIssue({ code: 'custom', message: 'voicePrice' })
      return z.NEVER
    }
    return n
  })

export const voiceSettingsSchema = z.object({
  enabled: checkbox,
  inputEnabled: checkbox,
  outputEnabled: checkbox,
  provider: z.enum(VOICE_PROVIDERS),
  inputPrice: optionalPrice,
  outputPrice: optionalPrice,
  monthlyBudget: z.coerce.number('budgetInvalid').min(0, 'budgetInvalid').max(100000, 'budgetInvalid'),
  dailyMinutes: z.coerce.number('voiceMinutes').int('voiceMinutes').min(1, 'voiceMinutes').max(600, 'voiceMinutes'),
})

/** Usage reported by the browser path (no cost; the database prices nothing for 'browser'). */
export const voiceUsageSchema = z.object({
  tenant: z.string().min(1).max(64),
  surface: z.enum(VOICE_SURFACES),
  kind: z.enum(['input', 'output']),
  seconds: z.number().min(0).max(600).default(0),
  characters: z.number().int().min(0).max(20000).default(0),
})
