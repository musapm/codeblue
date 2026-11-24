import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { asKind, readAccess, readHours, type Access, type Hours, type Kind } from './schemas'

/** Read side of the campus module. RLS: members see published locations, campus managers all of them. */

const log = logger.child({ module: 'campus' })

function fail(op: string, error: { code?: string }): never {
  log.error('campus.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

type Row = Database['public']['Tables']['campus_locations']['Row']
export type Location = Omit<Row, 'kind' | 'opening_hours' | 'accessibility' | 'search_text' | 'created_by' | 'latitude' | 'longitude'> & {
  kind: Kind
  hours: Hours | null
  access: Access
  latitude: number | null
  longitude: number | null
}

const COLUMNS =
  'id, tenant_id, kind, name, name_ar, code, description, description_ar, parent_id, floor, department_id, latitude, longitude, opening_hours, hours_note, hours_note_ar, accessibility, accessibility_note, accessibility_note_ar, phone, email, url, aliases, published, created_at, updated_at'

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

function toLocation(r: Record<string, unknown>): Location {
  const row: Record<string, unknown> = { ...r }
  for (const key of ['opening_hours', 'accessibility', 'search_text', 'created_by', 'score']) delete row[key]
  return {
    ...(row as unknown as Location),
    kind: asKind(String(r.kind)),
    hours: readHours(r.opening_hours),
    access: readAccess(r.accessibility),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
  }
}

export type CampusStatus = { feature: boolean; aiEnabled: boolean; aiWithinBudget: boolean }

export async function getCampusStatus(slug: string): Promise<CampusStatus> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('campus_status', { p_tenant_slug: slug })
  if (error) fail('campus_status', error)
  const s = (data ?? {}) as Record<string, unknown>
  return { feature: s.feature === true, aiEnabled: s.ai_enabled === true, aiWithinBudget: s.ai_within_budget === true }
}

/** Published locations, ranked by the query (all of them when the query is empty). */
export async function searchLocations(slug: string, q: string, kind: Kind | null, limit = 200): Promise<Location[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('campus_search', { p_tenant_slug: slug, p_query: q, p_kind: kind, p_limit: limit })
  if (error) fail('campus_search', error)
  return (Array.isArray(data) ? data : []).flatMap((r) => (r && typeof r === 'object' && 'id' in r ? [toLocation(r as Record<string, unknown>)] : []))
}

/** Every location the caller may see (managers: drafts too). */
export async function listLocations(tenantId: string): Promise<Location[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('campus_locations').select(COLUMNS).eq('tenant_id', tenantId).order('name').limit(1000)
  if (error) fail('campus_locations', error)
  return (data ?? []).map((r) => toLocation(r as unknown as Record<string, unknown>))
}

export async function getLocation(tenantId: string, id: string): Promise<Location | null> {
  if (!z.uuid().safeParse(id).success) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('campus_locations').select(COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) fail('campus_location', error)
  return data ? toLocation(data as unknown as Record<string, unknown>) : null
}

export async function listChildren(tenantId: string, parentId: string): Promise<Location[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('campus_locations').select(COLUMNS).eq('tenant_id', tenantId).eq('parent_id', parentId).order('floor').order('name').limit(500)
  if (error) fail('campus_children', error)
  return (data ?? []).map((r) => toLocation(r as unknown as Record<string, unknown>))
}

/** Names of locations by id (for building names). */
export async function locationNames(tenantId: string, ids: string[]): Promise<Map<string, { name: string; name_ar: string | null }>> {
  const wanted = [...new Set(ids)]
  if (!wanted.length) return new Map()
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('campus_locations').select('id, name, name_ar').eq('tenant_id', tenantId).in('id', wanted)
  if (error) fail('campus_names', error)
  return new Map((data ?? []).map((l) => [l.id, { name: l.name, name_ar: l.name_ar }]))
}

export type CampusSettings = { aiEnabled: boolean; monthlyBudgetUsd: number; dailyLimit: number }

/** Defaults (no row yet) match the table: answers off, 5 USD a month, 30 questions per person per day. */
export async function getCampusSettings(tenantId: string): Promise<CampusSettings> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('campus_settings').select('ai_enabled, monthly_budget_usd, daily_limit').eq('tenant_id', tenantId).maybeSingle()
  if (error) fail('campus_settings', error)
  return data ? { aiEnabled: data.ai_enabled, monthlyBudgetUsd: Number(data.monthly_budget_usd), dailyLimit: data.daily_limit } : { aiEnabled: false, monthlyBudgetUsd: 5, dailyLimit: 30 }
}

export type CampusUsage = { locations: number; published: number; questions: number; costUsd: number }

export async function getCampusUsage(slug: string): Promise<CampusUsage> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('campus_usage', { p_tenant_slug: slug })
  if (error) fail('campus_usage', error)
  const u = (data ?? {}) as Record<string, unknown>
  return { locations: Number(u.locations ?? 0), published: Number(u.published ?? 0), questions: Number(u.questions ?? 0), costUsd: Number(u.cost_usd ?? 0) }
}
