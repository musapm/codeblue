import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from './safe-redirect'

const FALLBACK = '/en/app'

describe('safeRedirectPath', () => {
  it.each([
    ['/en/app', '/en/app'],
    ['/ar/app/northbridge/settings?tab=branding#colors', '/ar/app/northbridge/settings?tab=branding#colors'],
    ['/en/login?next=%2Fen%2Fapp', '/en/login?next=%2Fen%2Fapp'],
  ])('accepts same-origin path %s', (input, expected) => {
    expect(safeRedirectPath(input, FALLBACK)).toBe(expected)
  })

  it.each([
    'https://evil.example',
    'http://evil.example/en/app',
    '//evil.example',
    '//evil.example/path',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'data:text/html,hi',
    'en/app',
    '',
    '   ',
    '/%2F%2Fevil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/' + 'a'.repeat(3000),
  ])('rejects %j', (input) => {
    expect(safeRedirectPath(input, FALLBACK)).toBe(FALLBACK)
  })

  it('rejects non-string values', () => {
    expect(safeRedirectPath(null, FALLBACK)).toBe(FALLBACK)
    expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK)
    expect(safeRedirectPath(['/en/app'], FALLBACK)).toBe(FALLBACK)
  })
})
