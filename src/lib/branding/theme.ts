/**
 * Tenant theme engine.
 *
 * Turns a tenant's brand colors into CSS custom properties. Every color is validated as a
 * strict hex value first: tenant input ends up inside a `style` attribute, so accepting
 * arbitrary strings would allow CSS injection. Invalid values fall back to defaults.
 */

export type ThemeColors = {
  primary: string
  secondary: string
  accent: string
}

export type ThemeInput = Partial<Record<keyof ThemeColors, string | null | undefined>>

export const DEFAULT_THEME: ThemeColors = {
  primary: '#1b4f8f', // deep university blue
  secondary: '#0f2a4a', // ink navy
  accent: '#b7862c', // academic gold
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** Normalize `#ABC` / `#AABBCC` to lowercase `#aabbcc`; returns null for anything else. */
export function parseHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!HEX.test(value)) return null
  const hex = value.slice(1).toLowerCase()
  return hex.length === 3 ? `#${[...hex].map((c) => c + c).join('')}` : `#${hex}`
}

function toRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}

export const LIGHT_TEXT = '#ffffff'
export const DARK_TEXT = '#0b1220'

/** Pick white or near-black text, whichever reads better on `background`. */
export function readableForeground(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT
}

/** Mix `hex` toward `target` by `amount` (0–1). */
export function mix(hex: string, target: string, amount: number): string {
  const a = toRgb(hex)
  const b = toRgb(target)
  return toHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as [number, number, number])
}

export function resolveTheme(input: ThemeInput = {}): ThemeColors {
  return {
    primary: parseHexColor(input.primary) ?? DEFAULT_THEME.primary,
    secondary: parseHexColor(input.secondary) ?? DEFAULT_THEME.secondary,
    accent: parseHexColor(input.accent) ?? DEFAULT_THEME.accent,
  }
}

export type ThemeVariables = Record<`--${string}`, string>

/** CSS custom properties consumed by Tailwind tokens in globals.css. */
export function buildThemeVariables(input: ThemeInput = {}): ThemeVariables {
  const theme = resolveTheme(input)
  const primaryFg = readableForeground(theme.primary)
  return {
    '--brand-primary': theme.primary,
    '--brand-primary-foreground': primaryFg,
    '--brand-primary-hover': mix(theme.primary, primaryFg === LIGHT_TEXT ? '#000000' : '#ffffff', 0.14),
    '--brand-primary-subtle': mix(theme.primary, '#ffffff', 0.9),
    '--brand-primary-subtle-foreground': mix(theme.primary, '#000000', 0.25),
    '--brand-secondary': theme.secondary,
    '--brand-secondary-foreground': readableForeground(theme.secondary),
    '--brand-accent': theme.accent,
    '--brand-accent-foreground': readableForeground(theme.accent),
    '--brand-ring': mix(theme.primary, '#ffffff', 0.35),
  }
}

export type ContrastIssue = { pair: 'primary' | 'secondary' | 'accent' | 'primaryOnWhite'; ratio: number; minimum: number }

/** WCAG AA checks (4.5:1 for normal text) used by the branding editor to warn admins. */
export function assessThemeContrast(input: ThemeInput = {}): ContrastIssue[] {
  const theme = resolveTheme(input)
  const checks: ContrastIssue[] = [
    { pair: 'primary', ratio: contrastRatio(theme.primary, readableForeground(theme.primary)), minimum: 4.5 },
    { pair: 'secondary', ratio: contrastRatio(theme.secondary, readableForeground(theme.secondary)), minimum: 4.5 },
    { pair: 'accent', ratio: contrastRatio(theme.accent, readableForeground(theme.accent)), minimum: 3 },
    // Primary is also used for links and icons on white surfaces.
    { pair: 'primaryOnWhite', ratio: contrastRatio(theme.primary, '#ffffff'), minimum: 4.5 },
  ]
  return checks.filter((c) => c.ratio < c.minimum).map((c) => ({ ...c, ratio: Math.round(c.ratio * 100) / 100 }))
}
