import { z } from 'zod'

/**
 * Campus map and assistant (Phase 12): kinds, weekly hours, accessibility facts, the simple map
 * projection and the form schemas. Pure and client-safe; the database checks the same rules
 * (app.campus_hours_valid, app.campus_access_valid and the table constraints).
 */

export const KINDS = [
  'building',
  'office',
  'classroom',
  'lab',
  'library',
  'cafeteria',
  'clinic',
  'prayer_room',
  'parking',
  'gate',
  'sports',
  'residence',
  'service',
  'other',
] as const
export type Kind = (typeof KINDS)[number]
export const asKind = (k: string): Kind => ((KINDS as readonly string[]).includes(k) ? (k as Kind) : 'other')

/** Weekdays as stored; the display order starts on Saturday or Monday by locale in the pages. */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Day = (typeof DAYS)[number]

export const ACCESS_KEYS = ['step_free_entrance', 'elevator', 'accessible_toilet', 'accessible_parking', 'hearing_loop', 'braille_signage'] as const
export type AccessKey = (typeof ACCESS_KEYS)[number]

export type Range = [string, string]
export type Hours = Partial<Record<Day, Range[]>>
export type Access = Partial<Record<AccessKey, boolean>>

const START = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const END = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/

const RangeSchema = z.tuple([z.string().regex(START), z.string().regex(END)]).refine(([a, b]) => a < b)
const HoursSchema = z.partialRecord(z.enum(DAYS), z.array(RangeSchema).max(3))
const AccessSchema = z.partialRecord(z.enum(ACCESS_KEYS), z.boolean())

/** Stored hours, read leniently (null: no hours given, which is not the same as closed). */
export function readHours(value: unknown): Hours | null {
  if (value === null || value === undefined) return null
  const parsed = HoursSchema.safeParse(value)
  return parsed.success ? (parsed.data as Hours) : null
}

export function readAccess(value: unknown): Access {
  const parsed = AccessSchema.safeParse(value)
  return parsed.success ? (parsed.data as Access) : {}
}

/** "08:00-12:00, 13:00-16:00" → ranges; "" → [] (closed that day); null when not valid. */
export function parseDayRanges(text: string): Range[] | null {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/[,،;]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length > 3) return null
  const ranges: Range[] = []
  for (const part of parts) {
    const m = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/.exec(part)
    if (!m) return null
    const range: Range = [`${m[1]!.padStart(2, '0')}:${m[2]}`, `${m[3]!.padStart(2, '0')}:${m[4]}`]
    if (!RangeSchema.safeParse(range).success) return null
    ranges.push(range)
  }
  return ranges
}

export const formatDayRanges = (ranges: Range[] | undefined) => (ranges ?? []).map(([a, b]) => `${a}-${b}`).join(', ')

/** The weekday and time (HH:MM) at an instant in a time zone. */
export function localDayTime(timeZone: string, now: Date): { day: Day; time: string } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { day: get('weekday').toLowerCase().slice(0, 3) as Day, time: `${get('hour')}:${get('minute')}` }
}

export type OpenStatus = { state: 'unknown' } | { state: 'open'; until: string } | { state: 'closed'; opens: { day: Day; time: string; today: boolean } | null }

/** Open or closed now, from weekly hours in the university's time zone. */
export function openStatus(hours: Hours | null, timeZone: string, now: Date): OpenStatus {
  if (!hours) return { state: 'unknown' }
  const { day, time } = localDayTime(timeZone, now)
  const today = hours[day] ?? []
  const current = today.find(([a, b]) => a <= time && time < b)
  if (current) return { state: 'open', until: current[1] }
  const laterToday = today.filter(([a]) => a > time).sort(([a], [b]) => a.localeCompare(b))[0]
  if (laterToday) return { state: 'closed', opens: { day, time: laterToday[0], today: true } }
  const start = DAYS.indexOf(day)
  for (let i = 1; i <= 7; i++) {
    const d = DAYS[(start + i) % 7]!
    const first = [...(hours[d] ?? [])].sort(([a], [b]) => a.localeCompare(b))[0]
    if (first) return { state: 'closed', opens: { day: d, time: first[0], today: false } }
  }
  return { state: 'closed', opens: null }
}

// ---------------------------------------------------------------------------
// The simple map: coordinates projected onto a box (no map tiles, no third-party requests)
// ---------------------------------------------------------------------------

export type MapPoint = { id: string; lat: number; lon: number }

/** Equirectangular projection fitted into width × height with padding; north up. */
export function projectPoints(points: MapPoint[], width: number, height: number, padding: number): { id: string; x: number; y: number }[] {
  if (points.length === 0) return []
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length
  const k = Math.cos((meanLat * Math.PI) / 180)
  const xs = points.map((p) => p.lon * k)
  const ys = points.map((p) => p.lat)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const spanX = maxX - minX
  const spanY = maxY - minY
  const innerW = width - 2 * padding
  const innerH = height - 2 * padding
  const scale = spanX === 0 && spanY === 0 ? 0 : Math.min(spanX ? innerW / spanX : Infinity, spanY ? innerH / spanY : Infinity)
  const offsetX = padding + (innerW - spanX * scale) / 2
  const offsetY = padding + (innerH - spanY * scale) / 2
  return points.map((p, i) => ({
    id: p.id,
    x: Math.round((offsetX + (xs[i]! - minX) * scale) * 10) / 10,
    y: Math.round((offsetY + (maxY - ys[i]!) * scale) * 10) / 10,
  }))
}

/** A link to the location on OpenStreetMap (opened only when the person clicks it). */
export const osmLink = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`

// ---------------------------------------------------------------------------
// Form input (Server Actions)
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, max > 300 ? 'messageTooLong' : 'nameTooLong')
    .optional()
    .transform((s) => (s ? s : null))
const optionalUuid = z
  .string()
  .optional()
  .transform((s) => (s ? s : null))
  .pipe(z.uuid().nullable())
const coordinate = (limit: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? s : null))
    .pipe(
      z
        .string()
        .regex(/^-?\d{1,3}(\.\d{1,6})?$/, 'campusCoordinates')
        .refine((s) => Math.abs(Number(s)) <= limit, 'campusCoordinates')
        .nullable(),
    )
const dayHours = z
  .string()
  .optional()
  .transform((s, ctx) => {
    const ranges = parseDayRanges(s ?? '')
    if (ranges === null) {
      ctx.addIssue({ code: 'custom', message: 'campusHours' })
      return z.NEVER
    }
    return ranges
  })
const tristate = z
  .enum(['yes', 'no', ''])
  .optional()
  .transform((v) => (v === 'yes' ? true : v === 'no' ? false : null))

export const locationSchema = z
  .object({
    kind: z.enum(KINDS),
    name: z.string().trim().min(2, 'nameRequired').max(160, 'nameTooLong'),
    nameAr: optionalText(160),
    code: z
      .string()
      .trim()
      .optional()
      .transform((s) => (s ? s : null))
      .pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,19}$/, 'campusCode').nullable()),
    description: optionalText(1000),
    descriptionAr: optionalText(1000),
    parentId: optionalUuid,
    floor: optionalText(20),
    departmentId: optionalUuid,
    latitude: coordinate(90),
    longitude: coordinate(180),
    hoursKnown: z
      .union([z.literal('on'), z.literal('')])
      .optional()
      .transform((v) => v === 'on'),
    ...(Object.fromEntries(DAYS.map((d) => [`hours_${d}`, dayHours])) as Record<`hours_${Day}`, typeof dayHours>),
    hoursNote: optionalText(300),
    hoursNoteAr: optionalText(300),
    ...(Object.fromEntries(ACCESS_KEYS.map((k) => [`access_${k}`, tristate])) as Record<`access_${AccessKey}`, typeof tristate>),
    accessibilityNote: optionalText(500),
    accessibilityNoteAr: optionalText(500),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((s) => (s ? s : null))
      .pipe(z.string().regex(/^\+?[0-9() .-]{6,32}$/, 'phoneInvalid').nullable()),
    email: z
      .string()
      .trim()
      .optional()
      .transform((s) => (s ? s.toLowerCase() : null))
      .pipe(z.email('emailInvalid').max(254, 'emailInvalid').nullable()),
    url: z
      .string()
      .trim()
      .optional()
      .transform((s) => (s ? s : null))
      .pipe(z.string().max(500, 'urlInvalid').regex(/^https:\/\/\S+$/, 'urlInvalid').nullable()),
    aliases: z
      .string()
      .optional()
      .transform((s) =>
        (s ?? '')
          .split(/[\n,،]/)
          .map((a) => a.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().max(80, 'campusAliases')).max(20, 'campusAliases')),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), { path: ['longitude'], message: 'campusCoordinates' })

export type LocationInput = z.infer<typeof locationSchema>

/** The JSON object campus_save_location expects. */
export function toLocationPayload(v: LocationInput) {
  const hours: Hours = {}
  for (const d of DAYS) {
    const ranges = v[`hours_${d}`]
    if (ranges.length) hours[d] = ranges
  }
  const access: Access = {}
  for (const k of ACCESS_KEYS) {
    const value = v[`access_${k}`]
    if (value !== null) access[k] = value
  }
  return {
    kind: v.kind,
    name: v.name,
    name_ar: v.nameAr,
    code: v.code,
    description: v.description,
    description_ar: v.descriptionAr,
    parent_id: v.kind === 'building' ? null : v.parentId,
    floor: v.floor,
    department_id: v.departmentId,
    latitude: v.latitude,
    longitude: v.longitude,
    opening_hours: v.hoursKnown ? hours : null,
    hours_note: v.hoursNote,
    hours_note_ar: v.hoursNoteAr,
    accessibility: access,
    accessibility_note: v.accessibilityNote,
    accessibility_note_ar: v.accessibilityNoteAr,
    phone: v.phone,
    email: v.email,
    url: v.url,
    aliases: v.aliases,
  }
}

export const campusSettingsSchema = z.object({
  aiEnabled: z
    .union([z.literal('on'), z.literal('true'), z.literal('')])
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
  monthlyBudget: z.coerce.number('budgetInvalid').min(0, 'budgetInvalid').max(100000, 'budgetInvalid'),
  dailyLimit: z.coerce.number('dailyLimitWorkflow').int('dailyLimitWorkflow').min(1, 'dailyLimitWorkflow').max(200, 'dailyLimitWorkflow'),
})

export const askSchema = z.object({ question: z.string().trim().min(3, 'campusQuestion').max(500, 'messageTooLong') })
