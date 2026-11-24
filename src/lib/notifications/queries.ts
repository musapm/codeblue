import 'server-only'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NOTIFICATION_KINDS, type NotificationKind, type Preference } from './schemas'

const log = logger.child({ module: 'notifications' })
function fail(op: string, error: { code?: string }): never {
  log.error('notifications.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export async function getMyPreferences(slug: string): Promise<Preference[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('my_notification_preferences', { p_tenant_slug: slug })
  if (error) fail('my_notification_preferences', error)
  return (Array.isArray(data) ? data : []).flatMap((p) => {
    const r = p as { kind?: string; in_app?: boolean; email?: boolean }
    return r.kind && (NOTIFICATION_KINDS as readonly string[]).includes(r.kind) ? [{ kind: r.kind as NotificationKind, inApp: r.in_app !== false, email: r.email === true }] : []
  })
}

export type OutboxSummary = { queued: number; sent: number; failed: number; oldestQueuedAt: string | null }

export async function getOutboxSummary(slug: string): Promise<OutboxSummary> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('outbox_summary', { p_tenant_slug: slug })
  if (error) fail('outbox_summary', error)
  const s = (data ?? {}) as Record<string, unknown>
  return { queued: Number(s.queued ?? 0), sent: Number(s.sent ?? 0), failed: Number(s.failed ?? 0), oldestQueuedAt: typeof s.oldest_queued_at === 'string' ? s.oldest_queued_at : null }
}
