import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { DRAFT_KINDS, DraftContent, DraftSources, type DraftKind } from './schemas'

/**
 * Read side of the staff assistant (Phase 10). Drafts are private to their author (RLS);
 * settings and usage are returned only to people with `assistant.configure`.
 */

const log = logger.child({ module: 'staff' })

function fail(op: string, error: { code?: string }): never {
  log.error('staff.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type StaffStatus = { canUse: boolean; feature: boolean; enabled: boolean; withinBudget: boolean; canDigest: boolean }

export async function getStaffStatus(slug: string): Promise<StaffStatus> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('staff_assistant_status', { p_tenant_slug: slug })
  if (error) fail('staff_assistant_status', error)
  const s = (data ?? {}) as Record<string, unknown>
  return { canUse: s.can_use === true, feature: s.feature === true, enabled: s.enabled === true, withinBudget: s.within_budget === true, canDigest: s.can_digest === true }
}

export type StaffSettings = { enabled: boolean; instructions: string | null; monthlyBudgetUsd: number; dailyLimit: number }

/** Defaults (no row yet) match the table defaults: off, $20 a month, 60 requests per person per day. */
export async function getStaffSettings(tenantId: string): Promise<StaffSettings> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('staff_assistant_settings')
    .select('enabled, instructions, monthly_budget_usd, daily_limit')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) fail('staff_assistant_settings', error)
  return data
    ? { enabled: data.enabled, instructions: data.instructions, monthlyBudgetUsd: Number(data.monthly_budget_usd), dailyLimit: data.daily_limit }
    : { enabled: false, instructions: null, monthlyBudgetUsd: 20, dailyLimit: 60 }
}

export type StaffUsage = { questions: number; drafts: number; people: number; costUsd: number }

export async function getStaffUsage(slug: string): Promise<StaffUsage> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('staff_assistant_usage', { p_tenant_slug: slug })
  if (error) fail('staff_assistant_usage', error)
  const u = (data ?? {}) as Record<string, unknown>
  return { questions: Number(u.questions ?? 0), drafts: Number(u.drafts ?? 0), people: Number(u.people ?? 0), costUsd: Number(u.cost_usd ?? 0) }
}

export type DraftSummary = { id: string; kind: DraftKind; title: string; language: 'en' | 'ar'; createdAt: string }

const kindOf = (k: string): DraftKind => ((DRAFT_KINDS as readonly string[]).includes(k) ? (k as DraftKind) : 'email')
const languageOf = (l: string): 'en' | 'ar' => (l === 'ar' ? 'ar' : 'en')

/** The caller's own drafts, newest first. */
export async function listDrafts(tenantId: string, limit = 50): Promise<DraftSummary[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('staff_drafts')
    .select('id, kind, title, language, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) fail('staff_drafts', error)
  return (data ?? []).map((d) => ({ id: d.id, kind: kindOf(d.kind), title: d.title, language: languageOf(d.language), createdAt: d.created_at }))
}

export type Draft = DraftSummary & { content: DraftContent; sources: z.infer<typeof DraftSources>; model: string }

/** One of the caller's drafts (null when it is not theirs or does not exist). */
export async function getDraft(tenantId: string, draftId: string): Promise<Draft | null> {
  if (!z.uuid().safeParse(draftId).success) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('staff_drafts')
    .select('id, kind, title, language, content, sources, model, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', draftId)
    .maybeSingle()
  if (error) fail('staff_draft', error)
  if (!data) return null
  const content = DraftContent.safeParse(data.content)
  return {
    id: data.id,
    kind: kindOf(data.kind),
    title: data.title,
    language: languageOf(data.language),
    createdAt: data.created_at,
    content: content.success ? content.data : { subject: null, body: '', missing: [] },
    sources: DraftSources.parse(data.sources),
    model: data.model,
  }
}
