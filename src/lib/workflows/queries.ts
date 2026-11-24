import 'server-only'
import { z } from 'zod'
import { sanitizeLeadSearch } from '@/lib/admissions/schemas'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { CatalogForm } from './ai'
import { asStatus, FINAL_STATUSES, OPEN_STATUSES, readFields, type FormField, type RequestStatus } from './schemas'

/**
 * Read side of service request workflows. RLS decides visibility: forms (published ones for
 * members, drafts for form managers), requests (own / department / all / assigned) and their
 * history (internal events never for the requester).
 */

const log = logger.child({ module: 'workflows' })

function fail(op: string, error: { code?: string }): never {
  log.error('workflows.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

type DefinitionRow = Database['public']['Tables']['workflow_definitions']['Row']
type VersionRow = Database['public']['Tables']['workflow_versions']['Row']
type RequestRow = Database['public']['Tables']['workflow_requests']['Row']
export type RequestEvent = Database['public']['Tables']['workflow_request_events']['Row']

export type Definition = DefinitionRow
export type Version = Omit<VersionRow, 'fields'> & { fields: FormField[] }
export type ServiceRequest = Omit<RequestRow, 'status'> & { status: RequestStatus }

const toVersion = (v: VersionRow): Version => ({ ...v, fields: readFields(v.fields) })
const toRequest = (r: RequestRow): ServiceRequest => ({ ...r, status: asStatus(r.status) })

export type WorkflowStatus = { feature: boolean; canSubmit: boolean; aiEnabled: boolean; aiWithinBudget: boolean }

export async function getWorkflowStatus(slug: string): Promise<WorkflowStatus> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('workflow_status', { p_tenant_slug: slug })
  if (error) fail('workflow_status', error)
  const s = (data ?? {}) as Record<string, unknown>
  return { feature: s.feature === true, canSubmit: s.can_submit === true, aiEnabled: s.ai_enabled === true, aiWithinBudget: s.ai_within_budget === true }
}

export type PublishedForm = { definition: Definition; version: Version }

/** Forms requesters can use now: active, with their published version. */
export async function listPublishedForms(tenantId: string): Promise<PublishedForm[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('workflow_definitions').select('*').eq('tenant_id', tenantId).eq('status', 'active').order('title').limit(200)
  if (error) fail('workflow_definitions', error)
  const definitions = (data ?? []).filter((d) => d.current_version_id)
  if (definitions.length === 0) return []
  const versions = await supabase
    .from('workflow_versions')
    .select('*')
    .in(
      'id',
      definitions.map((d) => d.current_version_id!),
    )
  if (versions.error) fail('workflow_versions', versions.error)
  const byId = new Map((versions.data ?? []).map((v) => [v.id, toVersion(v)]))
  return definitions.flatMap((d) => {
    const version = byId.get(d.current_version_id!)
    return version && version.fields.length ? [{ definition: d, version }] : []
  })
}

export function toCatalog(forms: PublishedForm[], locale: string): CatalogForm[] {
  return forms.map(({ definition: d, version: v }) => ({
    id: d.id,
    versionId: v.id,
    key: d.key,
    title: (locale === 'ar' && d.title_ar) || d.title,
    description: (locale === 'ar' && d.description_ar) || d.description,
    fields: v.fields,
  }))
}

export async function getPublishedForm(tenantId: string, definitionId: string): Promise<PublishedForm | null> {
  if (!z.uuid().safeParse(definitionId).success) return null
  return (await listPublishedForms(tenantId)).find((f) => f.definition.id === definitionId) ?? null
}

/** The caller's own requests, newest activity first. */
export async function listMyRequests(tenantId: string, userId: string): Promise<ServiceRequest[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('workflow_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('requester_id', userId)
    .order('last_activity_at', { ascending: false })
    .limit(200)
  if (error) fail('my_workflow_requests', error)
  return (data ?? []).map(toRequest)
}

export type RequestQueue = 'mine' | 'department' | 'unassigned' | 'all'
export type QueueFilters = { queue: RequestQueue; state: 'open' | 'done'; status?: RequestStatus; q?: string }

/** A processing queue (never the caller's own requests). RLS has limited the rows already. */
export async function listRequestQueue(tenantId: string, userId: string, departmentIds: string[], f: QueueFilters): Promise<ServiceRequest[]> {
  const supabase = await createSupabaseServerClient()
  let q = supabase.from('workflow_requests').select('*').eq('tenant_id', tenantId).neq('requester_id', userId)
  q = f.status ? q.eq('status', f.status) : q.in('status', f.state === 'open' ? [...OPEN_STATUSES] : [...FINAL_STATUSES])
  if (f.queue === 'mine') q = q.eq('assignee_id', userId)
  if (f.queue === 'department') q = departmentIds.length ? q.in('department_id', departmentIds) : q.eq('id', '00000000-0000-0000-0000-000000000000')
  if (f.queue === 'unassigned') q = q.is('assignee_id', null)
  const term = sanitizeLeadSearch(f.q)
  if (term) q = q.or(`reference.ilike.%${term}%,requester_name.ilike.%${term}%`)
  const { data, error } = await q.order('last_activity_at', { ascending: f.state === 'open' }).limit(200)
  if (error) fail('workflow_queue', error)
  return (data ?? []).map(toRequest)
}

/** Titles of the forms behind a list of requests (archived forms included). */
export async function definitionTitles(tenantId: string, ids: string[]): Promise<Map<string, { title: string; title_ar: string | null }>> {
  if (ids.length === 0) return new Map()
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('workflow_definitions').select('id, title, title_ar').eq('tenant_id', tenantId).in('id', [...new Set(ids)])
  if (error) fail('workflow_titles', error)
  return new Map((data ?? []).map((d) => [d.id, { title: d.title, title_ar: d.title_ar }]))
}

export type RequestDetail = { request: ServiceRequest; definition: Pick<Definition, 'id' | 'title' | 'title_ar' | 'department_id'>; version: Version; events: RequestEvent[] }

export async function getRequest(tenantId: string, id: string): Promise<RequestDetail | null> {
  if (!z.uuid().safeParse(id).success) return null
  const supabase = await createSupabaseServerClient()
  const request = await supabase.from('workflow_requests').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (request.error) fail('workflow_request', request.error)
  if (!request.data) return null
  const [definition, version, events] = await Promise.all([
    supabase.from('workflow_definitions').select('id, title, title_ar, department_id').eq('id', request.data.definition_id).maybeSingle(),
    supabase.from('workflow_versions').select('*').eq('id', request.data.version_id).maybeSingle(),
    supabase.from('workflow_request_events').select('*').eq('request_id', id).order('created_at').order('id').limit(500),
  ])
  if (definition.error) fail('workflow_definition', definition.error)
  if (version.error) fail('workflow_version', version.error)
  if (events.error) fail('workflow_events', events.error)
  if (!definition.data || !version.data) return null
  return { request: toRequest(request.data), definition: definition.data, version: toVersion(version.data), events: events.data ?? [] }
}

export async function listAssignees(slug: string, departmentId: string | null): Promise<{ user_id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('workflow_assignees', { p_tenant_slug: slug, p_department: departmentId })
  if (error) fail('workflow_assignees', error)
  return z.array(z.object({ user_id: z.string(), name: z.string() })).catch([]).parse(data)
}

// ---------------------------------------------------------------------------
// Form management
// ---------------------------------------------------------------------------

export type DefinitionSummary = Definition & { draft: boolean; versionNo: number | null }

export async function listDefinitions(tenantId: string): Promise<DefinitionSummary[]> {
  const supabase = await createSupabaseServerClient()
  const [definitions, versions] = await Promise.all([
    supabase.from('workflow_definitions').select('*').eq('tenant_id', tenantId).order('title').limit(500),
    supabase.from('workflow_versions').select('definition_id, version_no, status').eq('tenant_id', tenantId).in('status', ['draft', 'published']).limit(2000),
  ])
  if (definitions.error) fail('workflow_definitions', definitions.error)
  if (versions.error) fail('workflow_versions', versions.error)
  const rows = versions.data ?? []
  return (definitions.data ?? []).map((d) => ({
    ...d,
    draft: rows.some((v) => v.definition_id === d.id && v.status === 'draft'),
    versionNo: rows.find((v) => v.definition_id === d.id && v.status === 'published')?.version_no ?? null,
  }))
}

export async function getDefinition(tenantId: string, id: string): Promise<{ definition: Definition; versions: Version[]; requests: number } | null> {
  if (!z.uuid().safeParse(id).success) return null
  const supabase = await createSupabaseServerClient()
  const definition = await supabase.from('workflow_definitions').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (definition.error) fail('workflow_definition', definition.error)
  if (!definition.data) return null
  const [versions, requests] = await Promise.all([
    supabase.from('workflow_versions').select('*').eq('definition_id', id).order('version_no', { ascending: false }).limit(100),
    supabase.from('workflow_requests').select('id', { count: 'exact', head: true }).eq('definition_id', id),
  ])
  if (versions.error) fail('workflow_versions', versions.error)
  return { definition: definition.data, versions: (versions.data ?? []).map(toVersion), requests: requests.count ?? 0 }
}

export type WorkflowSettings = { aiEnabled: boolean; monthlyBudgetUsd: number; dailyLimit: number }

/** Defaults (no row yet) match the table: suggestions off, 10 USD a month, 20 per person per day. */
export async function getWorkflowSettings(tenantId: string): Promise<WorkflowSettings> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('workflow_settings').select('ai_enabled, monthly_budget_usd, daily_limit').eq('tenant_id', tenantId).maybeSingle()
  if (error) fail('workflow_settings', error)
  return data ? { aiEnabled: data.ai_enabled, monthlyBudgetUsd: Number(data.monthly_budget_usd), dailyLimit: data.daily_limit } : { aiEnabled: false, monthlyBudgetUsd: 10, dailyLimit: 20 }
}

export type WorkflowUsage = { requests: number; fromAssistant: number; suggestions: number; costUsd: number }

export async function getWorkflowUsage(slug: string): Promise<WorkflowUsage> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('workflow_usage', { p_tenant_slug: slug })
  if (error) fail('workflow_usage', error)
  const u = (data ?? {}) as Record<string, unknown>
  return { requests: Number(u.requests ?? 0), fromAssistant: Number(u.from_assistant ?? 0), suggestions: Number(u.suggestions ?? 0), costUsd: Number(u.cost_usd ?? 0) }
}
