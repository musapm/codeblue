import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'
import { Field } from './field'
import { Input } from './input'

describe('Button', () => {
  it('defaults to type="button" so it never submits forms by accident', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('renders its child when asChild is set', () => {
    render(
      <Button asChild>
        <a href="https://example.com/contact">Contact</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Contact' })
    expect(link).toHaveAttribute('href', 'https://example.com/contact')
    expect(link).not.toHaveAttribute('type')
  })
})

describe('Field', () => {
  it('links label, hint and error to the control', () => {
    const { rerender } = render(
      <Field label="Email address" hint="We never share it.">
        <Input name="email" />
      </Field>,
    )
    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAccessibleDescription('We never share it.')
    expect(input).not.toHaveAttribute('aria-invalid')

    rerender(
      <Field label="Email address" hint="We never share it." error="Enter a valid email address.">
        <Input name="email" />
      </Field>,
    )
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Email address')).toHaveAccessibleDescription('Enter a valid email address.')
  })
})

describe('Avatar', () => {
  it('uses two initials for Latin names and one for Arabic names', async () => {
    const { Avatar } = await import('./misc')
    const { container, rerender } = render(<Avatar label="Amina Hassan" />)
    expect(container.textContent).toBe('AH')
    rerender(<Avatar label="مسؤول المعاينة" />)
    expect(container.textContent).toBe('م')
  })
})
