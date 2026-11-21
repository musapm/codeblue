import 'server-only'
import { z } from 'zod'

/**
 * Server-only configuration. Importing this module from a Client Component fails the
 * build (`server-only`), which keeps secrets out of browser bundles.
 *
 * Read lazily (call `getServerEnv()` inside request-time code) so values reflect the
 * runtime environment rather than the build machine.
 */

const flag = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1')

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  UNIAGENT_UI_PREVIEW: flag,
  // Supabase secret (service-role) key: reserved for background jobs (Phase 2+).
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))].join(', ')
    throw new Error(`Invalid server environment configuration: ${names}. See docs/environment-variables.md.`)
  }
  return result.data
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv({
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    UNIAGENT_UI_PREVIEW: process.env.UNIAGENT_UI_PREVIEW,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  })
}
