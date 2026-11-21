import { z } from 'zod'

/**
 * Public (browser-safe) configuration. Only `NEXT_PUBLIC_*` variables belong here; Next.js
 * inlines them at build time, so each must be referenced literally (no dynamic access).
 * Never put secrets in NEXT_PUBLIC_* variables.
 */

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.url({ protocol: /^https?$/ }).optional())

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional()

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: optionalUrl.optional(),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl.optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
})

export type PublicEnv = {
  siteUrl: string
  supabaseUrl: string | undefined
  supabasePublishableKey: string | undefined
}

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(raw)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))].join(', ')
    // Report variable names only — never values.
    throw new Error(`Invalid public environment configuration: ${names}. See docs/environment-variables.md.`)
  }
  const env = result.data
  return {
    siteUrl: (env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    // Prefer the new publishable key; fall back to the legacy anon key name.
    supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
}

export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})
