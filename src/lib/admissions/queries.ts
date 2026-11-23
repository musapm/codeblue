import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { sanitizeLeadSearch } from './schemas'

/** Staff read side of admissions. RLS decides what is returned (leads.read / programs.manage). */

const log = logger.child({ module: 'admissions' })

function fail(op: string, error: { code?: string }): never {
  log.error('admissions.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type Program = Database['public']['Tables']['admission_programs']['Row']
export type Lead = Database['public']['Tables']['admission_leads']['Row']
export type LeadNote = Database['public']['Tables']['admission_lead_notes']['Row']
export type LeadEvent = Database['public']['Tables']['admission_lead_events']['Row']
export type AdmissionsSettings = Database['public']['Tables']['admissions_settings']['Row']
export type Assignee = { user_id: string; full_name: string | null; email: string | null }

export async function listPrograms(tenantId: string): Promise<Program[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('admission_programs').select('*').eq('tenant_id', tenantId).order('sort_order').order('name').limit(500)
  if (error) fail('admission_programs', error)
  return data ?? []
}

export async function getProgram(tenantId: string, id: string): Promise<Program | null> {
  if (!z.uuid().safeParse(id).success) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('admission_programs').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) fail('admission_program', error)
  return data
}

export async function getAdmissionsSettings(tenantId: string): Promise<AdmissionsSettings | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('admissions_settings').select('*').eq('tenant_id', tenantId).maybeSingle()
  if (error) fail('admissions_settings', error)
  return data
}

export type LeadFilters = { stage?: string; program?: string; assigned?: string; q?: string }

export async function listLeads(tenantId: string, userId: string, filters: LeadFilters): Promise<{ leads: Lead[]; total: number }> {
  const supabase = await createSupabaseServerClient()
  let query = supabase.from('admission_leads').select('*', { count: 'exact' }).eq('tenant_id', tenantId)
  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.program && z.uuid().safeParse(filters.program).success) query = query.eq('program_id', filters.program)
  if (filters.assigned === 'me') query = query.eq('assigned_to', userId)
  else if (filters.assigned === 'none') query = query.is('assigned_to', null)
  const q = sanitizeLeadSearch(filters.q)
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,reference.ilike.%${q}%`)
  const { data, error, count } = await query.order('created_at', { ascending: false }).limit(200)
  if (error) fail('admission_leads', error)
  return { leads: data ?? [], total: count ?? data?.length ?? 0 }
}

export async function getLead(tenantId: string, id: string): Promise<{ lead: Lead; notes: LeadNote[]; events: LeadEvent[] } | null> {
  if (!z.uuid().safeParse(id).success) return null
  const supabase = await createSupabaseServerClient()
  const lead = await supabase.from('admission_leads').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (lead.error) fail('admission_lead', lead.error)
  if (!lead.data) return null
  const [notes, events] = await Promise.all([
    supabase.from('admission_lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('admission_lead_events').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(200),
  ])
  if (notes.error) fail('admission_lead_notes', notes.error)
  if (events.error) fail('admission_lead_events', events.error)
  return { lead: lead.data, notes: notes.data ?? [], events: events.data ?? [] }
}

export async function listAssignees(slug: string): Promise<Assignee[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('admissions_assignees', { p_tenant_slug: slug })
  if (error) fail('admissions_assignees', error)
  return z
    .array(z.object({ user_id: z.string(), full_name: z.string().nullable().catch(null), email: z.string().nullable().catch(null) }))
    .catch([])
    .parse(data)
}

const countMap = z.record(z.string(), z.coerce.number()).catch({})

export const analyticsSchema = z.object({
  total: z.coerce.number().catch(0),
  last_30_days: z.coerce.number().catch(0),
  open: z.coerce.number().catch(0),
  unassigned_new: z.coerce.number().catch(0),
  by_stage: countMap,
  by_source: countMap,
  by_program: z
    .array(z.object({ program_id: z.string().nullable(), name: z.string().nullable(), name_ar: z.string().nullable(), count: z.coerce.number() }))
    .catch([]),
  weekly: z.array(z.object({ week_start: z.string(), count: z.coerce.number() })).catch([]),
  assistant: z
    .object({
      questions: z.coerce.number().catch(0),
      answered: z.coerce.number().catch(0),
      no_sources: z.coerce.number().catch(0),
      visitors: z.coerce.number().catch(0),
      cost_usd: z.coerce.number().catch(0),
    })
    .catch({ questions: 0, answered: 0, no_sources: 0, visitors: 0, cost_usd: 0 }),
})

export type AdmissionsAnalytics = z.infer<typeof analyticsSchema>

export async function getAdmissionsAnalytics(slug: string): Promise<AdmissionsAnalytics> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('admissions_analytics', { p_tenant_slug: slug })
  if (error) fail('admissions_analytics', error)
  return analyticsSchema.parse(data ?? {})
}
