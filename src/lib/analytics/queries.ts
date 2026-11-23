import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FlaggedSchema, GapSchema, OverviewSchema, QualityCountsSchema, type Agent, type Flagged, type Gap, type Overview, type Period, type QualityCounts } from './schemas'

/**
 * Read side of analytics and AI quality. The database computes every number and decides what
 * each person may see (migration 14); here the payloads are only validated.
 */

const log = logger.child({ module: 'analytics' })

function fail(op: string, error: { code?: string }): never {
  log.error('analytics.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

function parsed<T>(op: string, schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    log.error('analytics.invalid_payload', { op })
    throw new AppError('internal', `${op} returned an unexpected shape`)
  }
  return result.data
}

export async function getAnalyticsOverview(slug: string, days: Period): Promise<Overview> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('analytics_overview', { p_tenant_slug: slug, p_days: days })
  if (error) fail('analytics_overview', error)
  return parsed('analytics_overview', OverviewSchema, data)
}

/** The overview tiles must never break the home page: null when the numbers cannot be read. */
export async function getOverviewTiles(slug: string): Promise<Overview | null> {
  try {
    return await getAnalyticsOverview(slug, 7)
  } catch (error) {
    log.warn('analytics.tiles_unavailable', { error })
    return null
  }
}

export async function listQualityGaps(slug: string, f: { days: Period; agent: Agent | null; state: 'open' | 'reviewed' | 'all'; limit: number }): Promise<Gap[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('quality_gaps', { p_tenant_slug: slug, p_days: f.days, p_agent: f.agent, p_state: f.state, p_limit: f.limit })
  if (error) fail('quality_gaps', error)
  return parsed('quality_gaps', z.array(GapSchema), data)
}

export async function listFlagged(
  slug: string,
  f: { kind: 'negative' | 'refused'; days: Period; agent: Agent | null; state: 'open' | 'reviewed' | 'all'; limit: number },
): Promise<Flagged[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('quality_flagged', {
    p_tenant_slug: slug,
    p_kind: f.kind,
    p_days: f.days,
    p_agent: f.agent,
    p_state: f.state,
    p_limit: f.limit,
  })
  if (error) fail('quality_flagged', error)
  return parsed('quality_flagged', z.array(FlaggedSchema), data)
}

export async function getQualitySummary(slug: string, days: Period): Promise<QualityCounts> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('quality_summary', { p_tenant_slug: slug, p_days: days })
  if (error) fail('quality_summary', error)
  return parsed('quality_summary', QualityCountsSchema, data)
}
