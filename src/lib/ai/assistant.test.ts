// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Orchestration of one student question (answerQuestion), with the database client and the
 * Anthropic SDK replaced by fakes: no network, no cost. Live behaviour of the model itself is
 * covered by the opt-in eval suite (evals/assistant), which needs an API key.
 */

const state = vi.hoisted(() => ({
  configured: true,
  streamCalls: [] as unknown[],
  final: null as null | Record<string, unknown>,
  deltas: [] as string[],
  throwError: null as null | Error,
}))

vi.mock('./config', () => ({ getAiConfig: () => ({ configured: state.configured, model: 'claude-opus-5-5', effort: 'medium' }) }))

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500
  }
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static RateLimitError = RateLimitError
    beta = {
      messages: {
        stream: (params: unknown) => {
          state.streamCalls.push(params)
          if (state.throwError) throw state.throwError
          return {
            async *[Symbol.asyncIterator]() {
              for (const text of state.deltas) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
            },
            finalMessage: async () => state.final,
          }
        },
      },
    }
  }
  return { default: Anthropic }
})

const { answerQuestion } = await import('./assistant')

type Call = { fn: string; args: Record<string, unknown> }

function fakeSupabase(opts: { begin?: { data?: unknown; error?: { code: string } }; search?: unknown[] } = {}) {
  const calls: Call[] = []
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === 'assistant_begin_turn')
        return opts.begin?.error
          ? { data: null, error: opts.begin.error }
          : { data: opts.begin?.data ?? { conversation_id: 'conv-1', history: [], instructions: null, support_email: 'help@uni.example' }, error: null }
      if (fn === 'search_knowledge') return { data: opts.search ?? [], error: null }
      if (fn === 'assistant_complete_turn') return { data: 'msg-1', error: null }
      return { data: null, error: { code: 'XX000' } }
    },
  }
  return { supabase: supabase as never, calls }
}

const passage = {
  chunk_id: 42,
  document_id: 'doc-1',
  version_no: 1,
  title: 'Fees Policy',
  title_ar: null,
  page_from: 3,
  page_to: 3,
  heading: null,
  content: 'Tuition is 1,200 per semester.',
  score: 0.03,
}

const texts = { noSources: (email: string | null) => `NOT FOUND ${email ?? '-'}`, refused: 'REFUSED', failed: 'FAILED' }

async function run(supabase: never, question = 'How much is tuition?') {
  const events = []
  for await (const e of answerQuestion({
    supabase,
    tenantSlug: 'uni',
    conversationId: null,
    question,
    locale: 'en',
    university: { universityName: 'Uni', assistantName: 'Ava' },
    texts,
  }))
    events.push(e)
  return events
}

const usage = { input_tokens: 2000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 800 }

beforeEach(() => {
  state.configured = true
  state.streamCalls = []
  state.final = null
  state.deltas = []
  state.throwError = null
})

describe('answerQuestion', () => {
  it('without an API key it stops before touching the database', async () => {
    state.configured = false
    const { supabase, calls } = fakeSupabase()
    expect(await run(supabase)).toEqual([{ type: 'error', error: 'notConfigured' }])
    expect(calls).toEqual([])
  })

  it.each([
    ['55000', 'disabled'],
    ['53400', 'budget'],
    ['42501', 'forbidden'],
    ['22023', 'invalid'],
    ['P0002', 'notFound'],
    ['XX000', 'generic'],
  ])('maps database gate %s to %s and never calls the model', async (code, key) => {
    const { supabase, calls } = fakeSupabase({ begin: { error: { code } } })
    expect(await run(supabase)).toEqual([{ type: 'error', error: key }])
    expect(calls.map((c) => c.fn)).toEqual(['assistant_begin_turn'])
    expect(state.streamCalls).toHaveLength(0)
  })

  it('with no readable passages it answers "not found" without a model call and records no usage', async () => {
    const { supabase, calls } = fakeSupabase({ search: [] })
    const events = await run(supabase)
    expect(state.streamCalls).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'no_sources', text: 'NOT FOUND help@uni.example', citations: [] })
    const complete = calls.find((c) => c.fn === 'assistant_complete_turn')!
    expect(complete.args).toMatchObject({ p_status: 'no_sources', p_model: null, p_usage: null })
  })

  it('streams a grounded answer, maps citations and records model, usage and cost', async () => {
    state.deltas = ['Tuition is ', '1,200.']
    state.final = {
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      usage,
      content: [{ type: 'text', text: 'Tuition is 1,200.', citations: [{ type: 'search_result_location', search_result_index: 0, cited_text: 'Tuition is 1,200 per semester.' }] }],
    }
    const { supabase, calls } = fakeSupabase({ search: [passage] })
    const events = await run(supabase)

    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe('Tuition is 1,200.')
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'answered', messageId: 'msg-1', text: 'Tuition is 1,200. [1]' })

    const params = state.streamCalls[0] as Record<string, unknown>
    expect(params).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'medium' }, fallbacks: 'default' })
    expect(params).not.toHaveProperty('thinking')
    expect((params.system as Array<Record<string, unknown>>)[0]).toMatchObject({ cache_control: { type: 'ephemeral' } })
    expect(String((params.system as Array<{ text: string }>)[0]!.text)).toContain('help@uni.example')

    const complete = calls.find((c) => c.fn === 'assistant_complete_turn')!.args
    expect(complete).toMatchObject({ p_status: 'answered', p_model: 'claude-opus-5-5', p_conversation: 'conv-1' })
    expect(complete.p_usage).toEqual({ input_tokens: 2000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 800, cost_usd: 0.014 })
    expect(complete.p_citations).toEqual([expect.objectContaining({ n: 1, chunk_id: 42, document_id: 'doc-1', page_from: 3 })])
  })

  it('an answer that cites nothing is stored as a knowledge gap (no_sources)', async () => {
    state.final = { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'I could not find this in the documents.' }] }
    const { supabase } = fakeSupabase({ search: [passage] })
    expect((await run(supabase)).at(-1)).toMatchObject({ type: 'done', status: 'no_sources', text: 'I could not find this in the documents.' })
  })

  it('a refusal is stored with its usage and answered with the fixed text', async () => {
    state.final = { model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { category: 'cyber' }, usage, content: [] }
    const { supabase, calls } = fakeSupabase({ search: [passage] })
    expect((await run(supabase)).at(-1)).toMatchObject({ type: 'done', status: 'refused', text: 'REFUSED' })
    expect(calls.find((c) => c.fn === 'assistant_complete_turn')!.args).toMatchObject({ p_status: 'refused', p_model: 'claude-opus-5-5' })
  })

  it('an API failure is stored as an error turn and shown with the fixed text', async () => {
    state.throwError = new Error('network down')
    const { supabase, calls } = fakeSupabase({ search: [passage] })
    expect((await run(supabase)).at(-1)).toMatchObject({ type: 'done', status: 'error', text: 'FAILED' })
    expect(calls.find((c) => c.fn === 'assistant_complete_turn')!.args).toMatchObject({ p_status: 'error', p_usage: null })
  })

  it('retrieval runs with the follow-up context of the conversation', async () => {
    const { supabase, calls } = fakeSupabase({
      begin: { data: { conversation_id: 'conv-1', history: [{ role: 'user', content: 'How much is tuition?' }, { role: 'assistant', content: 'It is 1,200.' }], instructions: null, support_email: null } },
      search: [],
    })
    await run(supabase, 'When is it due?')
    expect(calls.find((c) => c.fn === 'search_knowledge')!.args).toMatchObject({ p_tenant_slug: 'uni', p_query: 'How much is tuition? When is it due?', p_limit: 6 })
  })
})
