import type { Locale } from '@/lib/i18n/config'

/** Locale-aware formatting for analytics figures (pure; used by server pages and tests). */

const tag = (locale: Locale) => (locale === 'ar' ? 'ar' : 'en')

export function formatNumber(locale: Locale, n: number): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 0 }).format(n)
}

/** Share as a whole percentage; null (nothing to divide) shows the dash. */
export function formatShare(locale: Locale, share: number | null, dash: string): string {
  return share === null ? dash : new Intl.NumberFormat(tag(locale), { style: 'percent', maximumFractionDigits: 0 }).format(share)
}

/** Money: whole amounts without cents ($60), others with cents ($6.80), small amounts up to 4 decimals ($0.0123). */
export function formatUsd(locale: Locale, n: number): string {
  const digits = Number.isInteger(n) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : n < 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  return new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'USD', ...digits }).format(n)
}

/** A duration given in minutes, in the largest sensible unit (minutes, hours, days). */
export function formatMinutes(locale: Locale, minutes: number | null, dash: string): string {
  if (minutes === null) return dash
  const unit = (value: number, u: 'minute' | 'hour' | 'day', digits: number) =>
    new Intl.NumberFormat(tag(locale), { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: digits }).format(value)
  if (minutes < 60) return unit(Math.round(minutes), 'minute', 0)
  if (minutes < 48 * 60) return unit(minutes / 60, 'hour', 1)
  return unit(minutes / (24 * 60), 'day', 1)
}

/** Milliseconds as seconds (answer times). */
export function formatSeconds(locale: Locale, ms: number | null, dash: string): string {
  if (ms === null) return dash
  return new Intl.NumberFormat(tag(locale), { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(ms / 1000)
}

/** A calendar day ("2026-11-23") as a short label; the date is the university's own day. */
export function formatDay(locale: Locale, ymd: string): string {
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`))
}

/** An instant in the university's time zone. */
export function formatInstant(locale: Locale, iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(tag(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat(tag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  }
}
