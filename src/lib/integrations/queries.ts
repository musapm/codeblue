import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const log = logger.child({ module: 'integrations' })
function fail(op: string, error: { code?: string }): never {
  log.error('integrations.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type Integration = Database['public']['Tables']['integrations']['Row']
export type IntegrationLog = Database['public']['Tables']['integration_logs']['Row']

export async function listIntegrations(tenantId: string): Promise<Integration[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('integrations').select('*').eq('tenant_id', tenantId).order('name').limit(200)
  if (error) fail('integrations', error)
  return data ?? []
}

export async function getIntegration(tenantId: string, id: string): Promise<{ integration: Integration; logs: IntegrationLog[] } | null> {
  if (!z.uuid().safeParse(id).success) return null
  const supabase = await createSupabaseServerClient()
  const found = await supabase.from('integrations').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (found.error) fail('integration', found.error)
  if (!found.data) return null
  const logs = await supabase.from('integration_logs').select('*').eq('integration_id', id).order('created_at', { ascending: false }).limit(100)
  if (logs.error) fail('integration_logs', logs.error)
  return { integration: found.data, logs: logs.data ?? [] }
}
