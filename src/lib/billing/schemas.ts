import { z } from 'zod'

/**
 * Plans and subscriptions (Phase 15). Prices are entered by platform staff: none are written
 * here. Amounts are kept in the currency's minor unit (cents, fils, ...); the number of decimals
 * comes from the currency itself (e.g. 2 for USD, 3 for KWD, 0 for JPY).
 */

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'card_offline', 'other'] as const
export const BILLING_INTERVALS = ['month', 'year'] as const

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** "1,200.50" in USD → 120050; null when the amount has more decimals than the currency allows. */
export function toMinor(amount: string, currency: string): number | null {
  const clean = amount.replace(/[,\s]/g, '')
  const digits = currencyDigits(currency)
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(clean)
  if (!m || (m[2]?.length ?? 0) > digits) return null
  return Number(m[1]) * 10 ** digits + Number((m[2] ?? '').padEnd(digits, '0') || 0)
}

export function formatMoney(minor: number, currency: string, locale: string): string {
  const digits = currencyDigits(currency)
  return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', { style: 'currency', currency, minimumFractionDigits: digits }).format(minor / 10 ** digits)
}

export const toMajor = (minor: number, currency: string) => (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency))

const optionalInt = (max: number, message: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((s, ctx) => {
      if (!s) return null
      if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > max) {
        ctx.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return Number(s)
    })

const optionalUsd = z
  .string()
  .trim()
  .optional()
  .transform((s, ctx) => {
    if (!s) return null
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) {
      ctx.addIssue({ code: 'custom', message: 'planAmount' })
      return z.NEVER
    }
    return Number(s)
  })

const currencyField = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'planCurrency'))

const days = (max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'planDays')
    .transform(Number)
    .refine((n) => n <= max, 'planDays')

export const planSchema = z
  .object({
    key: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_-]{1,39}$/, 'planKey'),
    name: z.string().trim().min(2, 'nameRequired').max(80, 'nameTooLong'),
    nameAr: z
      .string()
      .trim()
      .max(80, 'nameTooLong')
      .optional()
      .transform((s) => s || null),
    description: z
      .string()
      .trim()
      .max(1000, 'nameTooLong')
      .optional()
      .transform((s) => s || null),
    isActive: z.boolean(),
    currency: z
      .string()
      .trim()
      .optional()
      .transform((s) => (s ? s.toUpperCase() : null)),
    price: z
      .string()
      .trim()
      .optional()
      .transform((s) => s || null),
    interval: z.enum(BILLING_INTERVALS),
    trialDays: days(365),
    graceDays: days(90),
    maxMembers: optionalInt(1_000_000, 'planLimitValue'),
    maxDocuments: optionalInt(1_000_000, 'planLimitValue'),
    aiMonthlyUsd: optionalUsd,
    features: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(50),
  })
  .transform((v, ctx) => {
    // A price needs a currency and the reverse; neither means "by quote".
    if (!v.price && !v.currency) return { ...v, currency: null, priceMinor: null }
    if (!v.currency || !/^[A-Z]{3}$/.test(v.currency)) {
      ctx.addIssue({ code: 'custom', path: ['currency'], message: 'planCurrency' })
      return z.NEVER
    }
    const minor = v.price ? toMinor(v.price, v.currency) : null
    if (minor === null) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'planAmount' })
      return z.NEVER
    }
    return { ...v, priceMinor: minor }
  })

export const assignSchema = z
  .object({
    planKey: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
    mode: z.enum(['trial', 'paid']),
    months: z.string().optional(),
    note: z
      .string()
      .trim()
      .max(500, 'nameTooLong')
      .optional()
      .transform((s) => s || null),
  })
  .transform((v, ctx) => {
    if (v.mode === 'trial') return { ...v, months: null }
    const months = Number(v.months)
    if (!Number.isInteger(months) || months < 1 || months > 36) {
      ctx.addIssue({ code: 'custom', path: ['months'], message: 'planMonths' })
      return z.NEVER
    }
    return { ...v, months }
  })

export const limitsSchema = z.object({
  maxMembers: optionalInt(1_000_000, 'planLimitValue'),
  maxDocuments: optionalInt(1_000_000, 'planLimitValue'),
  aiMonthlyUsd: optionalUsd,
  billingNotes: z
    .string()
    .trim()
    .max(2000, 'nameTooLong')
    .optional()
    .transform((s) => s || null),
})

export const paymentSchema = z
  .object({
    amount: z.string().trim().min(1, 'planAmount'),
    currency: currencyField,
    method: z.enum(PAYMENT_METHODS),
    reference: z
      .string()
      .trim()
      .max(120, 'nameTooLong')
      .optional()
      .transform((s) => s || null),
    paidOn: z.iso.date('planDate'),
    extendsMonths: z
      .string()
      .trim()
      .regex(/^\d{1,2}$/, 'planMonths')
      .transform(Number)
      .refine((n) => n <= 36, 'planMonths'),
    note: z
      .string()
      .trim()
      .max(500, 'nameTooLong')
      .optional()
      .transform((s) => s || null),
  })
  .transform((v, ctx) => {
    const minor = toMinor(v.amount, v.currency)
    if (!minor) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'planAmount' })
      return z.NEVER
    }
    return { ...v, amountMinor: minor }
  })

/** YYYY-MM from a search param, or the current month. */
export function parseMonth(value: string | undefined, now = new Date()): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
