import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { staffEn } from '@/lib/i18n/dictionaries/staff.en'

vi.mock('@/lib/staff/actions', () => ({ generateDigestAction: vi.fn(), createDraftAction: vi.fn() }))
const { DigestView } = await import('./digest')

afterEach(cleanup)

const d = staffEn.digest
const labels = {
  scope: d.scope,
  department: d.department,
  allMyDepartments: d.allMyDepartments,
  submit: d.submit,
  submitting: d.submitting,
  privacy: d.privacy,
  empty: d.empty,
  overview: d.overview,
  themes: d.themes,
  attention: d.attention,
  suggestions: d.suggestions,
  notice: d.notice,
  aiLabel: staffEn.aiLabel,
  coveredSome: d.coveredSome,
  coveredAll: d.coveredAll,
  coveredOne: d.coveredOne,
}
const T1 = '44444444-4444-4444-8444-444444444444'
const digest = {
  overview: 'Mostly registration.',
  themes: [{ title: 'Registration', summary: 'Timetable clashes.', tickets: [{ id: T1, reference: 'T-00012' }] }],
  attention: [{ id: T1, reference: 'T-00012', reason: 'Urgent, no reply.' }],
  suggestions: ['Assign it today.'],
}

describe('DigestView', () => {
  it('says how many of the open tickets it covers', () => {
    const { rerender } = render(<DigestView result={{ digest, total: 75, covered: 60 }} ticketBase="/en/app/uni/tickets" labels={labels} locale="en" />)
    expect(screen.getByText('Based on the 60 most urgent of 75 open tickets.')).toBeInTheDocument()
    rerender(<DigestView result={{ digest, total: 12, covered: 12 }} ticketBase="/en/app/uni/tickets" labels={labels} locale="en" />)
    expect(screen.getByText('Based on 12 open tickets.')).toBeInTheDocument()
    rerender(<DigestView result={{ digest, total: 1, covered: 1 }} ticketBase="/en/app/uni/tickets" labels={labels} locale="en" />)
    expect(screen.getByText('Based on 1 open ticket.')).toBeInTheDocument()
  })

  it('labels the result as AI-made and links ticket references to the tickets', () => {
    render(<DigestView result={{ digest, total: 1, covered: 1 }} ticketBase="/en/app/uni/tickets" labels={labels} locale="en" />)
    expect(screen.getByText('AI-generated')).toBeInTheDocument()
    expect(screen.getByText(d.notice)).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'T-00012' })
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', `/en/app/uni/tickets/${T1}`)
    expect(screen.getByText('Urgent, no reply.')).toBeInTheDocument()
    expect(screen.getByText('Assign it today.')).toBeInTheDocument()
  })

  it('says so when the view has no open tickets', () => {
    render(<DigestView result={{ digest: null, total: 0, covered: 0 }} ticketBase="/en/app/uni/tickets" labels={labels} locale="en" />)
    expect(screen.getByRole('status')).toHaveTextContent(d.empty)
  })
})
