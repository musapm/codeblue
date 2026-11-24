// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { mfaStep, platformMfaRequired, verifyPath } = await import('./mfa')

describe('two-step sign-in rules', () => {
  const none = { current: 'aal1', next: 'aal1', verifiedFactorId: null }
  const firstStep = { current: 'aal1', next: 'aal2', verifiedFactorId: 'f1' }
  const secondStep = { current: 'aal2', next: 'aal2', verifiedFactorId: 'f1' }

  it('a first-step session of an account with a factor goes to the code step', () => {
    expect(mfaStep(firstStep, false)).toBe('verify')
    expect(mfaStep(firstStep, true)).toBe('verify') // the code comes before anything else
    expect(mfaStep(secondStep, true)).toBe('ok')
  })

  it('people without a factor are unaffected unless it is required (platform staff)', () => {
    expect(mfaStep(none, false)).toBe('ok')
    expect(mfaStep(none, true)).toBe('enroll')
  })

  it('platform staff need it unless explicitly made optional', () => {
    expect(platformMfaRequired({})).toBe(true)
    expect(platformMfaRequired({ PLATFORM_MFA: 'required' })).toBe(true)
    expect(platformMfaRequired({ PLATFORM_MFA: 'optional' })).toBe(false)
  })

  it('keeps where the person was going', () => {
    expect(verifyPath('/ar', '/ar/platform')).toBe('/ar/login/verify?next=%2Far%2Fplatform')
    expect(verifyPath('/en', undefined)).toBe('/en/login/verify')
  })
})
