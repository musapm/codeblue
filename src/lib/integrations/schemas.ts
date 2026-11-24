import { z } from 'zod'

/**
 * Integrations (Phase 14): the catalog of kinds, and the settings form. Settings are not secret
 * (a base URL, a site id); secrets stay in the server's secret store and only their NAME is kept
 * (secret_ref). No connector runs yet.
 */
export const INTEGRATION_KINDS = ['email', 'lms', 'sis', 'messaging', 'webhook', 'sso'] as const
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]
export const INTEGRATION_STATUSES = ['draft', 'active', 'paused', 'error'] as const

const SECRET_KEY = /(secret|password|passwd|token|api[_-]?key|private|credential)/i

/** "key = value" lines → an object; null when a line is malformed or a key names a secret. */
export function parseConfigLines(text: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = /^([a-z][a-z0-9_]{0,39})\s*=\s*(.{0,500})$/i.exec(line)
    if (!m || SECRET_KEY.test(m[1]!) || Object.keys(out).length >= 30) return null
    out[m[1]!.toLowerCase()] = m[2]!.trim()
  }
  return out
}

export const configLines = (config: unknown) =>
  config && typeof config === 'object'
    ? Object.entries(config as Record<string, unknown>)
        .map(([k, v]) => `${k} = ${String(v)}`)
        .join('\n')
    : ''

export const integrationSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  name: z.string().trim().min(2, 'nameRequired').max(120, 'nameTooLong'),
  config: z
    .string()
    .max(20000, 'integrationConfig')
    .optional()
    .transform((s, ctx) => {
      const parsed = parseConfigLines(s ?? '')
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: 'integrationConfig' })
        return z.NEVER
      }
      return parsed
    }),
  secretRef: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? s : null))
    .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'integrationSecretRef').nullable()),
})
