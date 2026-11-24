import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormField } from '@/lib/workflows/schemas'

vi.mock('@/lib/workflows/actions', () => ({ submitRequestAction: vi.fn(), suggestFormAction: vi.fn() }))
const { RequestForm } = await import('./request-form')

afterEach(cleanup)

const labels = {
  review: 'Review',
  edit: 'Change answers',
  confirmTitle: 'Check and confirm',
  confirmHint: 'This is what will be sent.',
  defaultConfirmation: 'Default confirmation',
  submit: 'Submit request',
  submitting: 'Submitting…',
  required: 'This is required.',
  invalid: 'Check this answer.',
  fixErrors: 'Some answers need attention.',
  choose: 'Choose…',
  prefilled: 'Filled in from your description.',
  notAnswered: 'Not answered',
  optional: 'optional',
  yes: 'Yes',
  no: 'No',
  aiLabel: 'Suggested by AI',
}
const messages = { errors: {} as never, validation: {} }
const fields: FormField[] = [
  { key: 'copies', type: 'number', label: 'Copies', required: true },
  { key: 'delivery', type: 'select', label: 'Delivery', required: true, options: [{ value: 'pickup', label: 'Pick up' }, { value: 'email', label: 'By email' }] },
  { key: 'notes', type: 'textarea', label: 'Notes', required: false },
  { key: 'confirm', type: 'checkbox', label: 'I confirm the details', required: true },
]
const form = { id: 'f1', versionId: 'v1', title: 'Transcript', fields, confirmation: 'I confirm this request.', confirmationAr: null }

describe('RequestForm', () => {
  it('checks the answers, then shows what will be sent and the confirmation before submitting', () => {
    render(<RequestForm tenant="uni" locale="en" form={form} labels={labels} messages={messages} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Some answers need attention.')
    expect(screen.getAllByText('This is required.')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull()

    fireEvent.change(screen.getByLabelText(/Copies/), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/Delivery/), { target: { value: 'email' } })
    fireEvent.click(screen.getByLabelText('I confirm the details'))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(screen.getByText('Check and confirm')).toBeInTheDocument()
    expect(screen.getByText('By email')).toBeInTheDocument()
    expect(screen.getByText('Not answered')).toBeInTheDocument()
    expect(screen.getByText('I confirm this request.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeInTheDocument()
    const hidden = document.querySelector<HTMLInputElement>('input[name="answers"]')!
    expect(JSON.parse(hidden.value)).toEqual({ copies: '2', delivery: 'email', confirm: true })

    fireEvent.click(screen.getByRole('button', { name: 'Change answers' }))
    expect(screen.getByLabelText(/Copies/)).toHaveValue('2')
  })

  it('marks an AI pre-filled form and leaves the confirmation for the person to tick', () => {
    // As suggestRequest returns them: no checkbox values.
    render(<RequestForm tenant="uni" locale="en" form={form} initialAnswers={{ copies: '3', delivery: 'pickup' }} source="assistant" labels={labels} messages={messages} />)
    expect(screen.getByText('Suggested by AI')).toBeInTheDocument()
    expect(screen.getByLabelText(/Copies/)).toHaveValue('3')
    expect(screen.getByLabelText(/Delivery/)).toHaveValue('pickup')
    expect(screen.getByLabelText('I confirm the details')).not.toBeChecked()
    expect(document.querySelector('input[name="source"]')).toBeNull() // only on the review step
  })
})
