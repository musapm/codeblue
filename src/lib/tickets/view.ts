import 'server-only'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import type { Locale } from '@/lib/i18n/config'
import type { TicketCategory } from './queries'
import { TICKET_PRIORITIES, TICKET_STATUSES } from './schemas'

/** Display helpers for ticket pages (server-side). */

type Variant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'outline'

export const STATUS_VARIANT: Record<string, Variant> = { open: 'info', in_progress: 'primary', waiting: 'warning', resolved: 'success', closed: 'neutral' }
export const PRIORITY_VARIANT: Record<string, Variant> = { low: 'outline', normal: 'neutral', high: 'warning', urgent: 'danger' }

export function categoryName(locale: Locale, c: Pick<TicketCategory, 'name' | 'name_ar'> | undefined, fallback: string): string {
  if (!c) return fallback
  return (locale === 'ar' && c.name_ar) || c.name
}

export function ticketOptions(dict: Dictionary) {
  const t = dict.tickets
  return {
    statuses: TICKET_STATUSES.map((s) => ({ value: s, label: t.staffStatuses[s] ?? s })),
    priorities: TICKET_PRIORITIES.map((p) => ({ value: p, label: t.priorities[p] ?? p })),
  }
}
