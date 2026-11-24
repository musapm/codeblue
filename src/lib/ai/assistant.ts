import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import type { Json } from '@/lib/supabase/database.types'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAiConfig } from './config'
import { estimateCostUsd } from './pricing'
import { buildMessages, buildSystemPrompt, mapCitations, retrievalQuery, type AnswerCitation, type HistoryTurn, type RetrievedChunk } from './prompt'

/**
 * One question → one grounded answer (docs/ai-architecture.md, request lifecycle), for three agents:
 * - student: gates in assistant_begin_turn (membership, permission, feature, switch, budget);
 *   retrieval as the student (search_knowledge: only passages they may read, before ranking).
 * - staff (Phase 10): gates in staff_begin_turn (assistant.staff.use, feature, switch, budget,
 *   daily limit); retrieval as the staff member, optionally limited to one department's documents.
 * - admissions: gates in admissions_begin_turn (public page and assistant on, budget, per-visitor
 *   limit; anonymous visitor sessions allowed); retrieval = public documents (admissions_search)
 *   plus the university's published program records.
 * Then, for all of them:
 *   → no passages: a fixed answer without any model call
 *   → Claude with the passages as citable search results (streamed)
 *   → citations mapped to chunks/pages → answer, usage and cost stored (assistant_complete_turn).
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type AssistantEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'status'; stage: 'searching' | 'writing' }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string | null; status: AnswerStatus; text: string; citations: AnswerCitation[] }
  | { type: 'error'; error: AssistantErrorKey }

export type AnswerStatus = 'answered' | 'no_sources' | 'refused' | 'error'
export type AssistantErrorKey = 'notConfigured' | 'disabled' | 'budget' | 'limit' | 'forbidden' | 'invalid' | 'notFound' | 'generic'
export type AgentKind = 'student' | 'admissions' | 'staff'

export type AssistantTexts = { noSources: (supportEmail: string | null) => string; refused: string; failed: string }

const log = logger.child({ module: 'assistant' })
const MAX_OUTPUT_TOKENS = 8000 // cost cap: answers are short; the cap only guards runaway output
const RETRIEVAL_LIMIT = 6

function beginError(code: string | undefined): AssistantErrorKey {
  switch (code) {
    case '55000':
      return 'disabled'
    case '53400':
      return 'budget'
    case '54000':
      return 'limit'
    case '42501':
      return 'forbidden'
    case '22023':
      return 'invalid'
    case 'P0002':
      return 'notFound'
    default:
      return 'generic'
  }
}

export async function* answerQuestion(opts: {
  supabase: Supabase
  tenantSlug: string
  conversationId: string | null
  question: string
  locale: string
  university: { universityName: string; assistantName: string }
  texts: AssistantTexts
  /** Default 'student'. */
  agent?: AgentKind
  /** Admissions only: the published programs (already selected for this question). */
  programs?: RetrievedChunk[]
  /** Staff only: limit retrieval to one department's documents (still only those they may read). */
  departmentId?: string | null
}): AsyncGenerator<AssistantEvent> {
  const agent = opts.agent ?? 'student'
  const ai = getAiConfig()
  if (!ai.configured) {
    yield { type: 'error', error: 'notConfigured' }
    return
  }
  const started = Date.now()
  const { supabase } = opts

  const beginArgs = { p_tenant_slug: opts.tenantSlug, p_conversation: opts.conversationId, p_question: opts.question }
  const begun =
    agent === 'admissions'
      ? await supabase.rpc('admissions_begin_turn', beginArgs)
      : agent === 'staff'
        ? await supabase.rpc('staff_begin_turn', beginArgs)
        : await supabase.rpc('assistant_begin_turn', beginArgs)
  if (begun.error) {
    const key = beginError(begun.error.code)
    if (key === 'generic') log.error('assistant.begin_failed', { code: begun.error.code })
    yield { type: 'error', error: key }
    return
  }
  const turn = begun.data as unknown as { conversation_id: string; history: HistoryTurn[]; instructions: string | null; support_email: string | null }
  const noSources = opts.texts.noSources(turn.support_email)
  yield { type: 'meta', conversationId: turn.conversation_id }

  const finish = async (status: AnswerStatus, text: string, citations: AnswerCitation[], extra: { sources?: Json[]; model?: string; usage?: { [key: string]: number } } = {}) => {
    const saved = await supabase.rpc('assistant_complete_turn', {
      p_conversation: turn.conversation_id,
      p_content: text,
      p_status: status,
      p_citations: citations as unknown as Json,
      p_sources: extra.sources ?? [],
      p_model: extra.model ?? null,
      p_usage: extra.usage ?? null,
      p_latency_ms: Date.now() - started,
    })
    if (saved.error) log.error('assistant.store_failed', { code: saved.error.code })
    return { type: 'done' as const, messageId: saved.data ?? null, status, text, citations }
  }

  yield { type: 'status', stage: 'searching' }
  const searchArgs = { p_tenant_slug: opts.tenantSlug, p_query: retrievalQuery(opts.question, turn.history), p_limit: RETRIEVAL_LIMIT }
  const search =
    agent === 'admissions'
      ? await supabase.rpc('admissions_search', searchArgs)
      : agent === 'staff'
        ? await supabase.rpc('search_knowledge', { ...searchArgs, p_department: opts.departmentId ?? null })
        : await supabase.rpc('search_knowledge', searchArgs)
  if (search.error) {
    log.error('assistant.search_failed', { code: search.error.code })
    yield await finish('error', opts.texts.failed, [])
    return
  }
  const chunks = [...((search.data ?? []) as unknown as RetrievedChunk[]), ...(agent === 'admissions' ? (opts.programs ?? []) : [])]
  const sources = chunks.map((c) =>
    c.program_id ? { program_id: c.program_id } : { chunk_id: c.chunk_id, document_id: c.document_id, version_no: c.version_no, score: c.score },
  )
  if (chunks.length === 0) {
    // Nothing the student may read matches: answer honestly without spending on the model.
    yield await finish('no_sources', noSources, [], { sources })
    return
  }

  yield { type: 'status', stage: 'writing' }
  const client = new Anthropic()
  try {
    const stream = client.beta.messages.stream({
      model: ai.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: ai.effort },
      // Refusal fallbacks: on a safety decline the API retries on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        {
          type: 'text',
          text: buildSystemPrompt({
            ...opts.university,
            supportEmail: turn.support_email,
            instructions: turn.instructions,
            audience: agent === 'admissions' ? 'applicants' : agent === 'staff' ? 'staff' : 'students',
          }),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: buildMessages({ history: turn.history, question: opts.question, chunks, locale: opts.locale }),
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'delta', text: event.delta.text }
    }
    const message = await stream.finalMessage()
    const usage = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cost_usd: estimateCostUsd(message.model, {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      }),
    }
    if (message.stop_reason === 'refusal') {
      log.info('assistant.refused', { category: message.stop_details?.category ?? null })
      yield await finish('refused', opts.texts.refused, [], { sources, model: message.model, usage })
      return
    }
    const mapped = mapCitations(message.content, chunks, opts.locale)
    // An answer that cites nothing could not be grounded in the documents (knowledge gap).
    const status: AnswerStatus = mapped.citations.length ? 'answered' : 'no_sources'
    yield await finish(status, mapped.text || noSources, mapped.citations, { sources, model: message.model, usage })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) log.warn('assistant.rate_limited')
    else if (error instanceof Anthropic.APIError) log.error('assistant.api_error', { status: error.status })
    else log.error('assistant.failed', { error })
    yield await finish('error', opts.texts.failed, [], { sources })
  }
}
