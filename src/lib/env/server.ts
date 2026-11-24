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
  // Embeddings for knowledge retrieval (Phase 4). Unset → full-text search only.
  EMBEDDINGS_PROVIDER: z.enum(['voyage', 'openai']).optional(),
  EMBEDDINGS_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._:-]{1,79}$/).optional(),
  EMBEDDINGS_API_KEY: z.string().min(1).optional(),
  // Claude API (Phase 5). Unset → the assistant reports "not configured" instead of answering.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._:-]{1,79}$/).optional(),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  // Shared rate limits (Phase 16): HMAC key for the database counters. Unset → per-instance memory.
  RATE_LIMIT_SECRET: z.string().min(32).optional(),
  // The client-IP header the hosting edge sets (Phase 16): x-forwarded-for (Vercel), cf-connecting-ip (behind Cloudflare), x-real-ip.
  TRUSTED_IP_HEADER: z.enum(['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip']).optional(),
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
    EMBEDDINGS_PROVIDER: process.env.EMBEDDINGS_PROVIDER || undefined,
    EMBEDDINGS_MODEL: process.env.EMBEDDINGS_MODEL || undefined,
    EMBEDDINGS_API_KEY: process.env.EMBEDDINGS_API_KEY || undefined,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    AI_MODEL: process.env.AI_MODEL || undefined,
    AI_EFFORT: process.env.AI_EFFORT || undefined,
    RATE_LIMIT_SECRET: process.env.RATE_LIMIT_SECRET || undefined,
    TRUSTED_IP_HEADER: process.env.TRUSTED_IP_HEADER || undefined,
  })
}
