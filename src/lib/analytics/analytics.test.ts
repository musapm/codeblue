// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatDay, formatMinutes, formatShare, formatUsd } from './format'
import { budgetLevel, FlaggedSchema, GapSchema, OverviewSchema, parseChoice, parsePeriod, ratio, reviewSchema } from './schemas'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('period and filters', () => {
  it('7 and 30 days for everyone, 90 only with advanced analytics, anything else falls back', () => {
    expect(parsePeriod('7', { advanced: false })).toBe(7)
    expect(parsePeriod('90', { advanced: false })).toBe(30)
    expect(parsePeriod('90', { advanced: true })).toBe(90)
    expect(parsePeriod('14', { advanced: true })).toBe(30)
    expect(parsePeriod(['7'], { advanced: true })).toBe(30)
    expect(parsePeriod(undefined, { advanced: true, fallback: 7 })).toBe(7)
    expect(parseChoice('negative', ['gaps', 'negative'] as const, 'gaps')).toBe('negative')
    expect(parseChoice('<script>', ['gaps', 'negative'] as const, 'gaps')).toBe('gaps')
  })
})

describe('honest figures', () => {
  it('a share of nothing is no number at all, not 0 %', () => {
    expect(ratio(0, 0)).toBeNull()
    expect(ratio(3, 4)).toBe(0.75)
    expect(formatShare('en', ratio(0, 0), '—')).toBe('—')
    expect(formatShare('en', ratio(2, 3), '—')).toBe('67%')
  })

  it('budget meter levels', () => {
    expect(budgetLevel(5, null)).toBe('none')
    expect(budgetLevel(5, 0)).toBe('none')
    expect(budgetLevel(7.9, 10)).toBe('normal')
    expect(budgetLevel(8, 10)).toBe('warning')
    expect(budgetLevel(10, 10)).toBe('over')
  })

  it('durations, money and days', () => {
    expect(formatMinutes('en', null, '—')).toBe('—')
    expect(formatMinutes('en', 45.4, '—')).toBe('45 min')
    expect(formatMinutes('en', 120, '—')).toBe('2 hr')
    expect(formatMinutes('en', 72 * 60, '—')).toBe('3 days')
    expect(formatUsd('en', 0.0123)).toBe('$0.0123')
    expect(formatUsd('en', 12)).toBe('$12')
    expect(formatUsd('en', 6.8)).toBe('$6.80')
    expect(formatUsd('en', 0.5)).toBe('$0.50')
    // A calendar day stays that day whatever the server's time zone.
    expect(formatDay('en', '2026-11-23')).toBe('Nov 23')
  })
})

describe('payloads', () => {
  it('the overview keeps sections that are off as null and fills nothing in', () => {
    const parsed = OverviewSchema.parse({
      period: { days: 7, from: '2026-11-17', to: '2026-11-23', since: '2026-11-16T21:00:00+00:00', timezone: 'Asia/Riyadh', bucket: 'day' },
      generated_at: '2026-11-23T10:00:00+00:00',
      members: { active: 3 },
      assistant: {
        student: { questions: 2, answered: 1, no_sources: 1, refused: 0, errors: 0, people: 1, helpful: 0, not_helpful: 0, median_latency_ms: null, series: [{ start: '2026-11-23', questions: 2, answered: 1, gaps: 1 }] },
      },
      tickets: null,
      admissions: null,
      knowledge: null,
      ai: null,
      quality: null,
      can: { costs: false, gaps: true, review: false, advanced: false },
    })
    expect(parsed.assistant?.student?.median_latency_ms).toBeNull()
    expect(parsed.assistant?.admissions).toBeUndefined()
    expect(parsed.tickets).toBeNull()
  })

  it('gaps and flagged answers carry no person; invalid ids are dropped', () => {
    const gap = GapSchema.parse({ question: 'When?', count: 2, open: 1, first_at: 'x', last_at: 'y', agents: ['student'], open_ids: [id(1)], reviewed_ids: ['nope'], review: null })
    expect(gap.reviewed_ids).toEqual([])
    const flagged = FlaggedSchema.parse({
      id: id(2),
      agent: 'student',
      status: 'answered',
      answered_at: 'x',
      rated_at: 'y',
      question: 'Q',
      comment: null,
      visible: false,
      answer: null,
      citations: [],
      review: null,
    })
    expect(flagged.visible).toBe(false)
  })

  it('a review covers 1–200 distinct answers with a known outcome and a short note', () => {
    expect(reviewSchema.parse({ messageIds: `${id(1)}, ${id(1)},${id(2)}`, outcome: 'correct', note: '  ' })).toEqual({ messageIds: [id(1), id(2)], outcome: 'correct', note: null })
    expect(reviewSchema.safeParse({ messageIds: '', outcome: 'correct' }).success).toBe(false)
    expect(reviewSchema.safeParse({ messageIds: 'not-a-uuid', outcome: 'correct' }).success).toBe(false)
    expect(reviewSchema.safeParse({ messageIds: id(1), outcome: 'great' }).success).toBe(false)
    expect(reviewSchema.safeParse({ messageIds: id(1), outcome: 'correct', note: 'x'.repeat(2001) }).success).toBe(false)
    const many = Array.from({ length: 201 }, (_, i) => id(i + 1)).join(',')
    expect(reviewSchema.safeParse({ messageIds: many, outcome: 'correct' }).success).toBe(false)
  })
})
