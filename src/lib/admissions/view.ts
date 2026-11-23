import 'server-only'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import type { Locale } from '@/lib/i18n/config'
import type { Assignee, Program } from './queries'
import { LEAD_STAGES, PROGRAM_LEVELS, STUDY_MODES, TEACHING_LANGUAGES, TUITION_PERIODS } from './schemas'

/** Display helpers for the admissions pages (server-side; dictionary functions stay here). */

export const STAGE_VARIANT: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'outline'> = {
  new: 'info',
  contacted: 'primary',
  qualified: 'primary',
  applied: 'warning',
  admitted: 'success',
  enrolled: 'success',
  lost: 'neutral',
}

export const PROGRAM_STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'outline'> = { draft: 'outline', published: 'success', archived: 'neutral' }

export function programName(locale: Locale, p: Pick<Program, 'name' | 'name_ar'>): string {
  return (locale === 'ar' && p.name_ar) || p.name
}

export function money(locale: Locale, amount: number, currency: string): string {
  try {
    const whole = Number.isInteger(amount)
    return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

export function personName(a: Assignee | undefined, fallback: string): string {
  return a?.full_name || a?.email || fallback
}

export function admissionsOptions(dict: Dictionary) {
  const a = dict.admissions
  return {
    levels: PROGRAM_LEVELS.map((v) => ({ value: v, label: a.levels[v] ?? v })),
    modes: STUDY_MODES.map((v) => ({ value: v, label: a.modes[v] ?? v })),
    languages: TEACHING_LANGUAGES.map((v) => ({ value: v, label: a.languages[v] ?? v })),
    periods: TUITION_PERIODS.map((v) => ({ value: v, label: a.periods[v] ?? v })),
    stages: LEAD_STAGES.map((v) => ({ value: v, label: a.stages[v] ?? v })),
    locales: [
      { value: 'en', label: dict.admissions.languages.en! },
      { value: 'ar', label: dict.admissions.languages.ar! },
    ],
  }
}
