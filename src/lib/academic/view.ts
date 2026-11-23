import type { Locale } from '@/lib/i18n/config'
import type { AcademicDictionary } from '@/lib/i18n/dictionaries/academic.en'
import type { ItemSource, SourceRef } from './schemas'

/** Display helpers for academic pages. */

export function courseTitle(locale: Locale, c: { title: string; title_ar: string | null }): string {
  return (locale === 'ar' && c.title_ar) || c.title
}

export function materialTitle(locale: Locale, m: { title: string; title_ar?: string | null; titleAr?: string | null }): string {
  return (locale === 'ar' && (m.title_ar ?? m.titleAr)) || m.title
}

/** "From: Week 1 notes, p. 3" for one reference into an item's sources (null when unknown). */
export function sourceLabel(locale: Locale, t: AcademicDictionary, sources: ItemSource[], ref: SourceRef): string | null {
  if (!ref) return null
  const s = sources[ref.m]
  if (!s) return null
  return `${materialTitle(locale, s)}${ref.pages ? `, ${t.pages(ref.pages)}` : ''}`
}

export const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'info' | 'outline'> = { draft: 'outline', active: 'success', archived: 'neutral' }

/** Allowed exam dates for a study plan: tomorrow to 90 days ahead (YYYY-MM-DD). */
export function examDateRange(now: number = Date.now()): { min: string; max: string } {
  return { min: new Date(now + 86_400_000).toISOString().slice(0, 10), max: new Date(now + 90 * 86_400_000).toISOString().slice(0, 10) }
}
