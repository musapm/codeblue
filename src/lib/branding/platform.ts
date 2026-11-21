import { DEFAULT_THEME, parseHexColor } from './theme'

/**
 * Platform-wide branding (the SaaS product itself, not a university).
 *
 * This is the ONLY place the product name is defined. UI code must read
 * `platformBranding.name` instead of hardcoding it (enforced by a unit test), so the
 * product can be renamed or white-labeled by changing environment variables.
 * Phase 3 moves these values into the `platform_settings` table, with env as fallback.
 */

export type PlatformBranding = {
  name: string
  shortName: string
  assistantName: string
  supportEmail: string
  salesEmail: string
  colors: { primary: string; secondary: string; accent: string }
}

const DEFAULT_PRODUCT_NAME = 'UniAgent AI'

function text(value: string | undefined, fallback: string, max = 60): string {
  const v = value?.trim()
  return v && v.length <= max ? v : fallback
}

export function resolvePlatformBranding(env: Record<string, string | undefined>): PlatformBranding {
  const name = text(env.NEXT_PUBLIC_PLATFORM_NAME, DEFAULT_PRODUCT_NAME)
  return {
    name,
    shortName: text(env.NEXT_PUBLIC_PLATFORM_SHORT_NAME, name.split(' ')[0] ?? name, 24),
    assistantName: text(env.NEXT_PUBLIC_PLATFORM_ASSISTANT_NAME, `${name} Assistant`),
    supportEmail: text(env.NEXT_PUBLIC_PLATFORM_SUPPORT_EMAIL, 'support@example.com', 120),
    salesEmail: text(env.NEXT_PUBLIC_PLATFORM_SALES_EMAIL, 'sales@example.com', 120),
    colors: {
      primary: parseHexColor(env.NEXT_PUBLIC_PLATFORM_PRIMARY_COLOR) ?? DEFAULT_THEME.primary,
      secondary: parseHexColor(env.NEXT_PUBLIC_PLATFORM_SECONDARY_COLOR) ?? DEFAULT_THEME.secondary,
      accent: parseHexColor(env.NEXT_PUBLIC_PLATFORM_ACCENT_COLOR) ?? DEFAULT_THEME.accent,
    },
  }
}

export const platformBranding: PlatformBranding = resolvePlatformBranding({
  NEXT_PUBLIC_PLATFORM_NAME: process.env.NEXT_PUBLIC_PLATFORM_NAME,
  NEXT_PUBLIC_PLATFORM_SHORT_NAME: process.env.NEXT_PUBLIC_PLATFORM_SHORT_NAME,
  NEXT_PUBLIC_PLATFORM_ASSISTANT_NAME: process.env.NEXT_PUBLIC_PLATFORM_ASSISTANT_NAME,
  NEXT_PUBLIC_PLATFORM_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_PLATFORM_SUPPORT_EMAIL,
  NEXT_PUBLIC_PLATFORM_SALES_EMAIL: process.env.NEXT_PUBLIC_PLATFORM_SALES_EMAIL,
  NEXT_PUBLIC_PLATFORM_PRIMARY_COLOR: process.env.NEXT_PUBLIC_PLATFORM_PRIMARY_COLOR,
  NEXT_PUBLIC_PLATFORM_SECONDARY_COLOR: process.env.NEXT_PUBLIC_PLATFORM_SECONDARY_COLOR,
  NEXT_PUBLIC_PLATFORM_ACCENT_COLOR: process.env.NEXT_PUBLIC_PLATFORM_ACCENT_COLOR,
})
