import { afterAll, describe, expect, it } from 'vitest'
import { answerQuestion, type AssistantEvent } from '../../src/lib/ai/assistant'
import { estimateCostUsd } from '../../src/lib/ai/pricing'
import { CASES, type EvalCase } from './cases'

/**
 * Live eval of the student assistant against the Claude API (opt-in, costs money).
 *
 *   RUN_AI_EVALS=1 ANTHROPIC_API_KEY=… npm run test:eval
 *
 * Runs the production code path (answerQuestion) with a fake database that returns the
 * case's passages and records what would be stored. Prints the measured tokens and the
 * estimated cost at the end. See docs/ai-evals.md.
 */

const enabled = process.env.RUN_AI_EVALS === '1' && !!process.env.ANTHROPIC_API_KEY

type Stored = { status: string; usage: Record<string, number> | null; model: string | null }
const totals = { cases: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 }

function fakeSupabase(c: EvalCase, stored: Stored[]) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'assistant_begin_turn')
        return { data: { conversation_id: 'eval', history: c.history ?? [], instructions: null, support_email: 'studentaffairs@northbridge.example' }, error: null }
      if (fn === 'search_knowledge') return { data: c.passages, error: null }
      if (fn === 'assistant_complete_turn') {
        stored.push({ status: String(args.p_status), usage: (args.p_usage as Record<string, number> | null) ?? null, model: (args.p_model as string | null) ?? null })
        return { data: 'eval-message', error: null }
      }
      return { data: null, error: { code: 'XX000' } }
    },
  } as never
}

/** Share of letters that are Arabic. */
function arabicShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return 0
  return letters.filter((l) => /\p{Script=Arabic}/u.test(l)).length / letters.length
}

describe.skipIf(!enabled)('student assistant eval (live Claude API)', () => {
  afterAll(() => {
    console.log(
      `\n[eval] ${totals.cases} cases · input ${totals.inputTokens} · output ${totals.outputTokens} · cache read ${totals.cacheReadTokens} · cache write ${totals.cacheWriteTokens} · estimated cost USD ${totals.cost.toFixed(4)}`,
    )
  })

  for (const c of CASES) {
    it(`${c.id} [${c.tags.join(', ')}]`, async () => {
      const stored: Stored[] = []
      const events: AssistantEvent[] = []
      for await (const e of answerQuestion({
        supabase: fakeSupabase(c, stored),
        tenantSlug: 'northbridge',
        conversationId: null,
        question: c.question,
        locale: c.locale,
        university: { universityName: 'Northbridge University', assistantName: 'Northbridge Assistant' },
        texts: {
          noSources: () => 'NOT_FOUND_FIXED_TEXT',
          refused: 'REFUSED_FIXED_TEXT',
          failed: 'FAILED_FIXED_TEXT',
        },
      }))
        events.push(e)

      const done = events.find((e) => e.type === 'done')
      totals.cases++
      const s = stored[0]
      if (s?.usage && s.model) {
        totals.inputTokens += s.usage.input_tokens ?? 0
        totals.outputTokens += s.usage.output_tokens ?? 0
        totals.cacheReadTokens += s.usage.cache_read_tokens ?? 0
        totals.cacheWriteTokens += s.usage.cache_write_tokens ?? 0
        totals.cost += estimateCostUsd(s.model, {
          inputTokens: s.usage.input_tokens ?? 0,
          outputTokens: s.usage.output_tokens ?? 0,
          cacheReadTokens: s.usage.cache_read_tokens ?? 0,
          cacheWriteTokens: s.usage.cache_write_tokens ?? 0,
        })
      }

      expect(done, 'the turn finished').toBeDefined()
      if (done?.type !== 'done') return
      const text = done.text
      console.log(`[eval] ${c.id}: ${done.status} · ${done.citations.length} citation(s)\n${text}\n`)

      expect(done.status, 'never an error turn').not.toBe('error')
      if (c.expect.status === 'answered') {
        expect(done.status).toBe('answered')
        for (const id of c.expect.cites ?? []) expect(done.citations.map((x) => x.chunk_id), `cites chunk ${id}`).toContain(id)
      } else {
        // Not grounded in any passage: either the fixed "not found" answer or an uncited answer.
        expect(['no_sources', 'refused']).toContain(done.status)
      }
      for (const re of c.expect.mentions ?? []) expect(text, `mentions ${re}`).toMatch(re)
      for (const re of c.expect.forbids ?? []) expect(text, `does not contain ${re}`).not.toMatch(re)
      if (c.expect.language === 'ar') expect(arabicShare(text), 'answers in Arabic').toBeGreaterThan(0.6)
      if (c.expect.language === 'en') expect(arabicShare(text), 'answers in English').toBeLessThan(0.2)
    })
  }
})

describe.skipIf(enabled)('student assistant eval', () => {
  it('is skipped: set RUN_AI_EVALS=1 and ANTHROPIC_API_KEY to run it (it calls the Claude API and costs money)', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12)
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length)
  })
})
