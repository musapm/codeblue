import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import type { LocationFormLabels } from '@/components/campus/location-form'
import type { Location } from './queries'
import { DAYS, localDayTime, openStatus, type Day, type OpenStatus } from './schemas'

/** Presentation helpers for the campus pages. */

/** Arabic-speaking universities usually start the week on Saturday. */
export const dayOrder = (locale: string): readonly Day[] => (locale === 'ar' ? ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] : DAYS)

export const locationName = (locale: string, l: { name: string; name_ar: string | null }) => (locale === 'ar' && l.name_ar) || l.name

export function statusText(dict: Dictionary, s: OpenStatus): string {
  const t = dict.campus.status
  if (s.state === 'unknown') return t.unknown
  if (s.state === 'open') return t.open(s.until)
  if (!s.opens) return t.closed
  return s.opens.today ? t.opensToday(s.opens.time) : t.opensOn(dict.campus.days[s.opens.day] ?? s.opens.day, s.opens.time)
}

export const STATUS_VARIANT = { open: 'success', closed: 'neutral', unknown: 'outline' } as const

export function locationFormLabels(dict: Dictionary): LocationFormLabels {
  const c = dict.campus
  return {
    sections: c.manage.sections,
    fields: c.manage.fields,
    hints: c.manage.hints,
    kinds: c.kinds,
    days: c.days,
    access: c.access,
    accessValues: c.accessValues,
    optional: dict.common.optional,
    submit: c.manage.save,
    saving: dict.management.saving,
  }
}

export function toFormValues(l: Location) {
  return {
    kind: l.kind,
    name: l.name,
    name_ar: l.name_ar,
    code: l.code,
    description: l.description,
    description_ar: l.description_ar,
    parent_id: l.parent_id,
    floor: l.floor,
    department_id: l.department_id,
    latitude: l.latitude,
    longitude: l.longitude,
    hours: l.hours,
    hours_note: l.hours_note,
    hours_note_ar: l.hours_note_ar,
    access: l.access,
    accessibility_note: l.accessibility_note,
    accessibility_note_ar: l.accessibility_note_ar,
    phone: l.phone,
    email: l.email,
    url: l.url,
    aliases: l.aliases,
  }
}

/** Open/closed at this moment (outside components: rendering stays free of clock reads). */
export function statusNow(l: Pick<Location, 'hours'>, timeZone: string): OpenStatus {
  return openStatus(l.hours, timeZone, new Date())
}

/** Today's weekday in the university's time zone. */
export function todayIn(timeZone: string): Day {
  return localDayTime(timeZone, new Date()).day
}
