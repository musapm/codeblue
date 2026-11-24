import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import { formatMoney } from './schemas'

export const SUBSCRIPTION_STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  trial: 'info',
  active: 'success',
  past_due: 'warning',
  suspended: 'danger',
  expired: 'danger',
  cancelled: 'warning',
}

export function planPrice(dict: Dictionary, locale: string, plan: { currency: string | null; price_minor: number | null; billing_interval: string }): string {
  if (plan.currency == null || plan.price_minor == null) return dict.billing.byQuote
  const price = formatMoney(plan.price_minor, plan.currency, locale)
  return plan.billing_interval === 'month' ? dict.billing.perInterval.month(price) : dict.billing.perInterval.year(price)
}

export const formatUsd = (value: number, locale: string) =>
  new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', { style: 'currency', currency: 'USD', maximumFractionDigits: value > 0 && value < 1 ? 4 : 2 }).format(value)

export const formatCount = (value: number, locale: string) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(value)

export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`
}

/** "12 of 50" or "12 (no limit)". */
export function usedOf(dict: Dictionary, locale: string, used: number, limit: number | null | undefined, money = false): string {
  const fmt = (n: number) => (money ? formatUsd(n, locale) : formatCount(n, locale))
  return limit == null ? dict.billing.subscription.unlimited(fmt(used)) : dict.billing.subscription.of(fmt(used), fmt(limit))
}

/** Platform roles that see plans, subscriptions, payments and usage (the database checks the same). */
export const BILLING_ROLES = ['owner', 'admin', 'billing']
