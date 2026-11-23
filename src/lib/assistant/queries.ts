import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Read side of the student assistant. RLS keeps conversations private to their author;
 * settings and usage are only returned to people with `assistant.configure`.
 */

const log = logger.child({ module: 'assistant' })

function fail(op: string, error: { code?: string }): never {
  log.error('assistant.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type ChatCitation = {
  n: number
  chunk_id: number
  document_id: string
  title: string
  page_from: number | null
  page_to: number | null
  cited_text: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'question' | 'answered' | 'no_sources' | 'refused' | 'error'
  citations: ChatCitation[]
  rating: -1 | 1 | null
  createdAt: string
}

export type ConversationSummary = { id: string; title: string; updatedAt: string }

const citationSchema = z.object({
  n: z.number().int(),
  chunk_id: z.number().int(),
  document_id: z.string(),
  title: z.string(),
  page_from: z.number().int().nullable(),
  page_to: z.number().int().nullable(),
  cited_text: z.string().catch(''),
})
const citationsSchema = z.array(citationSchema).catch([])

export async function getAssistantStatus(slug: string): Promise<{ canUse: boolean; feature: boolean; enabled: boolean; withinBudget: boolean }> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('assistant_status', { p_tenant_slug: slug })
  if (error) fail('assistant_status', error)
  const s = (data ?? {}) as { can_use?: boolean; feature?: boolean; enabled?: boolean; within_budget?: boolean }
  return { canUse: !!s.can_use, feature: !!s.feature, enabled: !!s.enabled, withinBudget: !!s.within_budget }
}

/** The caller's own recent conversations in this university. */
export async function listConversations(tenantId: string, limit = 30): Promise<ConversationSummary[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('assistant_conversations')
    .select('id, title, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) fail('assistant_conversations', error)
  return (data ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }))
}

/** Messages of one of the caller's conversations (null when it is not theirs or does not exist). */
export async function getConversation(tenantId: string, conversationId: string): Promise<{ id: string; title: string; messages: ChatMessage[] } | null> {
  if (!z.uuid().safeParse(conversationId).success) return null
  const supabase = await createSupabaseServerClient()
  const conversation = await supabase.from('assistant_conversations').select('id, title').eq('tenant_id', tenantId).eq('id', conversationId).maybeSingle()
  if (conversation.error) fail('assistant_conversation', conversation.error)
  if (!conversation.data) return null

  const [messages, feedback] = await Promise.all([
    supabase
      .from('assistant_messages')
      .select('id, role, content, status, citations, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase.from('assistant_feedback').select('message_id, rating').eq('tenant_id', tenantId),
  ])
  if (messages.error) fail('assistant_messages', messages.error)
  if (feedback.error) fail('assistant_feedback', feedback.error)
  const ratings = new Map((feedback.data ?? []).map((f) => [f.message_id, f.rating]))

  return {
    id: conversation.data.id,
    title: conversation.data.title,
    messages: (messages.data ?? []).map((m) => ({
      id: m.id,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
      status: m.status as ChatMessage['status'],
      citations: citationsSchema.parse(m.citations),
      rating: ratings.get(m.id) === 1 ? 1 : ratings.get(m.id) === -1 ? -1 : null,
      createdAt: m.created_at,
    })),
  }
}

export type AssistantSettings = { enabled: boolean; instructions: string | null; monthlyBudgetUsd: number; updatedAt: string | null }

export async function getAssistantSettings(tenantId: string): Promise<AssistantSettings> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('assistant_settings').select('enabled, instructions, monthly_budget_usd, updated_at').eq('tenant_id', tenantId).maybeSingle()
  if (error) fail('assistant_settings', error)
  if (!data) return { enabled: false, instructions: null, monthlyBudgetUsd: 50, updatedAt: null }
  return { enabled: data.enabled, instructions: data.instructions, monthlyBudgetUsd: Number(data.monthly_budget_usd), updatedAt: data.updated_at }
}

export type UsageSummary = {
  questions: number
  answered: number
  noSources: number
  refused: number
  errors: number
  helpful: number
  notHelpful: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export async function getUsageSummary(slug: string): Promise<UsageSummary> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('assistant_usage_summary', { p_tenant_slug: slug })
  if (error) fail('assistant_usage_summary', error)
  const u = (data ?? {}) as Record<string, number | string | undefined>
  const n = (k: string) => Number(u[k] ?? 0) || 0
  return {
    questions: n('questions'),
    answered: n('answered'),
    noSources: n('no_sources'),
    refused: n('refused'),
    errors: n('errors'),
    helpful: n('helpful'),
    notHelpful: n('not_helpful'),
    inputTokens: n('input_tokens'),
    outputTokens: n('output_tokens'),
    costUsd: n('cost_usd'),
  }
}
