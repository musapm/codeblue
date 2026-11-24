// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { platformBranding } from '@/lib/branding/platform'
import { en as englishDictionary } from '@/lib/i18n/dictionaries/en'
import { mapDbError } from '@/lib/management/action-state'
import { assignSchema, currencyDigits, formatMoney, limitsSchema, parseMonth, paymentSchema, planSchema, shiftMonth, toMajor, toMinor } from './schemas'
import { formatBytes, planPrice, usedOf } from './view'

const en = englishDictionary(platformBranding)

const plan = (v: Record<string, unknown> = {}) => ({
  key: 'standard',
  name: 'Standard',
  isActive: true,
  currency: 'usd',
  price: '12000.50',
  interval: 'year',
  trialDays: '30',
  graceDays: '14',
  maxMembers: '',
  maxDocuments: '500',
  aiMonthlyUsd: '25.5',
  features: ['knowledge_base'],
  ...v,
})

describe('money', () => {
  it('uses the currency’s own decimals', () => {
    expect(currencyDigits('USD')).toBe(2)
    expect(currencyDigits('KWD')).toBe(3)
    expect(currencyDigits('JPY')).toBe(0)
    expect(toMinor('1,200.5', 'USD')).toBe(120050)
    expect(toMinor('12', 'KWD')).toBe(12000)
    expect(toMinor('1.234', 'KWD')).toBe(1234)
    expect(toMinor('1.5', 'JPY')).toBeNull()
    expect(toMinor('1.234', 'USD')).toBeNull()
    for (const bad of ['', '-5', 'abc', '1e5']) expect(toMinor(bad, 'USD')).toBeNull()
    expect(toMajor(120050, 'USD')).toBe('1200.50')
    expect(formatMoney(120050, 'USD', 'en')).toBe('$1,200.50')
  })
})

describe('plan form', () => {
  it('reads a priced plan with limits', () => {
    expect(planSchema.parse(plan())).toMatchObject({ key: 'standard', currency: 'USD', priceMinor: 1200050, trialDays: 30, graceDays: 14, maxMembers: null, maxDocuments: 500, aiMonthlyUsd: 25.5 })
  })

  it('a plan without price and currency is by quote; one without the other is refused', () => {
    expect(planSchema.parse(plan({ currency: '', price: '' }))).toMatchObject({ currency: null, priceMinor: null })
    const err = (v: Record<string, unknown>) => planSchema.safeParse(plan(v)).error?.issues[0]
    expect(err({ currency: '' })).toMatchObject({ path: ['currency'], message: 'planCurrency' })
    expect(err({ price: '' })).toMatchObject({ path: ['price'], message: 'planAmount' })
    expect(err({ currency: 'DOLLARS' })?.message).toBe('planCurrency')
    expect(err({ price: '10.999' })?.message).toBe('planAmount')
  })

  it('checks the key, days and limits', () => {
    const err = (v: Record<string, unknown>) => planSchema.safeParse(plan(v)).error?.issues[0]?.message
    expect(err({ key: '1plan' })).toBe('planKey')
    expect(planSchema.parse(plan({ key: 'Gold' })).key).toBe('gold')
    expect(err({ trialDays: '400' })).toBe('planDays')
    expect(err({ graceDays: '91' })).toBe('planDays')
    expect(err({ maxMembers: '0' })).toBe('planLimitValue')
    expect(err({ maxDocuments: '2.5' })).toBe('planLimitValue')
    expect(err({ aiMonthlyUsd: '-1' })).toBe('planAmount')
    expect(err({ features: ['Bad Key'] })).toBeDefined()
  })
})

describe('subscription forms', () => {
  it('a trial needs no months; a paid period needs 1–36', () => {
    expect(assignSchema.parse({ planKey: 'standard', mode: 'trial', months: 'x' })).toMatchObject({ months: null })
    expect(assignSchema.parse({ planKey: 'standard', mode: 'paid', months: '12', note: ' pilot ' })).toMatchObject({ months: 12, note: 'pilot' })
    for (const months of ['0', '37', '', '1.5']) expect(assignSchema.safeParse({ planKey: 'standard', mode: 'paid', months }).error?.issues[0]?.message).toBe('planMonths')
  })

  it('payments: amount in the currency’s units, a date, months added', () => {
    const base = { amount: '1,000', currency: 'sar', method: 'bank_transfer', paidOn: '2026-11-01', extendsMonths: '12' }
    expect(paymentSchema.parse(base)).toMatchObject({ amountMinor: 100000, currency: 'SAR', extendsMonths: 12, reference: null })
    const err = (v: Record<string, unknown>) => paymentSchema.safeParse({ ...base, ...v }).error?.issues[0]?.message
    expect(err({ amount: '0' })).toBe('planAmount')
    expect(err({ method: 'crypto' })).toBeDefined()
    expect(err({ paidOn: '01/11/2026' })).toBe('planDate')
    expect(err({ extendsMonths: '40' })).toBe('planMonths')
  })

  it('limits: empty means the plan’s', () => {
    expect(limitsSchema.parse({ maxMembers: '', maxDocuments: '10', aiMonthlyUsd: '' })).toEqual({ maxMembers: null, maxDocuments: 10, aiMonthlyUsd: null, billingNotes: null })
  })
})

describe('report helpers', () => {
  it('months', () => {
    expect(parseMonth('2026-03')).toBe('2026-03')
    expect(parseMonth('2026-13', new Date('2026-11-24T00:00:00Z'))).toBe('2026-11')
    expect(parseMonth(undefined, new Date('2026-01-05T00:00:00Z'))).toBe('2026-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('labels', () => {
    expect(planPrice(en, 'en', { currency: null, price_minor: null, billing_interval: 'year' })).toBe('By quote')
    expect(planPrice(en, 'en', { currency: 'USD', price_minor: 99900, billing_interval: 'month' })).toBe('$999.00 / month')
    expect(usedOf(en, 'en', 12, 50)).toBe('12 of 50')
    expect(usedOf(en, 'en', 12, null)).toBe('12 (no limit)')
    expect(usedOf(en, 'en', 0.5, 10, true)).toBe('$0.50 of $10.00')
    expect(formatBytes(1536, 'en')).toBe('1.5 KB')
    expect(formatBytes(0, 'en')).toBe('0 B')
  })

  it('plan limits from the database become their own message', () => {
    expect(mapDbError({ code: '54000', message: 'plan limit reached: members' })).toBe('planLimit')
    expect(mapDbError({ code: '54000', message: 'daily limit reached' })).toBe('dailyLimit')
  })
})
