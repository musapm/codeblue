import { describe, expect, it } from 'vitest'
import {
  assessThemeContrast,
  buildThemeVariables,
  contrastRatio,
  DARK_TEXT,
  DEFAULT_THEME,
  LIGHT_TEXT,
  parseHexColor,
  readableForeground,
  resolveTheme,
} from './theme'

describe('parseHexColor', () => {
  it('normalizes valid hex colors', () => {
    expect(parseHexColor('#1B4F8F')).toBe('#1b4f8f')
    expect(parseHexColor(' #abc ')).toBe('#aabbcc')
  })

  it.each([
    'red',
    '#12345',
    '#1234567',
    '1b4f8f',
    '#1b4f8f; background:url(https://evil.example/x)',
    'url(javascript:alert(1))',
    'var(--x)',
    '#1b4f8f}body{display:none',
    '',
    null,
    undefined,
    42,
  ])('rejects %j (prevents CSS injection)', (input) => {
    expect(parseHexColor(input)).toBeNull()
  })
})

describe('contrast helpers', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('picks readable foregrounds', () => {
    expect(readableForeground('#1b4f8f')).toBe(LIGHT_TEXT)
    expect(readableForeground('#fde047')).toBe(DARK_TEXT)
  })
})

describe('theme variables', () => {
  it('falls back to defaults for invalid input', () => {
    expect(resolveTheme({ primary: 'not-a-color', accent: '#123' })).toEqual({
      ...DEFAULT_THEME,
      accent: '#112233',
    })
  })

  it('only ever emits hex values', () => {
    const vars = buildThemeVariables({ primary: '#0f766e', secondary: 'expression(alert(1))', accent: '#c2410c' })
    for (const value of Object.values(vars)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    expect(vars['--brand-primary']).toBe('#0f766e')
    expect(vars['--brand-secondary']).toBe(DEFAULT_THEME.secondary)
  })

  it('default theme passes contrast checks', () => {
    expect(assessThemeContrast(DEFAULT_THEME)).toEqual([])
  })

  it('flags low-contrast primary colors', () => {
    const issues = assessThemeContrast({ primary: '#ffeb3b' })
    expect(issues.map((i) => i.pair)).toContain('primaryOnWhite')
  })
})
