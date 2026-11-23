import { afterAll, describe, expect, it } from 'vitest'
import { programToChunk, selectPrograms } from '../../src/lib/admissions/public'
import { answerQuestion, type AssistantEvent } from '../../src/lib/ai/assistant'
import { estimateCostUsd } from '../../src/lib/ai/pricing'
import { CASES, type AdmissionsCase } from './cases'

/**
 * Live eval of the admissions assistant (opt-in, costs money):
 *
 *   RUN_AI_EVALS=1 ANTHROPIC_API_KEY=… npm run test:eval
 *
 * Runs the production path (answerQuestion with agent "admissions", program selection and program
 * passages) with a fake database that returns the case's public documents.
 */

const enabled = process.env.RUN_AI_EVALS === '1' && !!process.env.ANTHROPIC_API_KEY
const totals = { cases: 0, cost: 0 }

function fakeSupabase(c: AdmissionsCase, stored: Array<{ usage: Record<string, number> | null; model: string | null }>) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'admissions_begin_turn')
        return { data: { conversation_id: 'eval', history: [], instructions: null, support_email: 'admissions@northbridge.example' }, error: null }
      if (fn === 'admissions_search') return { data: c.documents, error: null }
      if (fn === 'assistant_complete_turn') {
        stored.push({ usage: (args.p_usage as Record<string, number> | null) ?? null, model: (args.p_model as string | null) ?? null })
        return { data: 'eval-message', error: null }
      }
      return { data: null, error: { code: 'XX000' } }
    },
  } as never
}

const arabicShare = (text: string) => {
  const letters = text.match(/\p{L}/gu) ?? []
  return letters.length ? letters.filter((l) => /\p{Script=Arabic}/u.test(l)).length / letters.length : 0
}

describe.skipIf(!enabled)('admissions assistant eval (live Claude API)', () => {
  afterAll(() => console.log(`\n[eval:admissions] ${totals.cases} cases · estimated cost USD ${totals.cost.toFixed(4)}`))

  for (const c of CASES) {
    it(`${c.id} [${c.tags.join(', ')}]`, async () => {
      const stored: Array<{ usage: Record<string, number> | null; model: string | null }> = []
      const events: AssistantEvent[] = []
      for await (const e of answerQuestion({
        supabase: fakeSupabase(c, stored),
        tenantSlug: 'northbridge',
        conversationId: null,
        question: c.question,
        locale: c.locale,
        university: { universityName: 'Northbridge University', assistantName: 'Northbridge Admissions' },
        texts: { noSources: () => 'NOT_FOUND_FIXED_TEXT', refused: 'REFUSED_FIXED_TEXT', failed: 'FAILED_FIXED_TEXT' },
        agent: 'admissions',
        programs: selectPrograms(c.question, c.programs).map(programToChunk),
      }))
        events.push(e)

      totals.cases++
      const s = stored[0]
      if (s?.usage && s.model)
        totals.cost += estimateCostUsd(s.model, {
          inputTokens: s.usage.input_tokens ?? 0,
          outputTokens: s.usage.output_tokens ?? 0,
          cacheReadTokens: s.usage.cache_read_tokens ?? 0,
          cacheWriteTokens: s.usage.cache_write_tokens ?? 0,
        })

      const done = events.find((e) => e.type === 'done')
      expect(done, 'the turn finished').toBeDefined()
      if (done?.type !== 'done') return
      console.log(`[eval:admissions] ${c.id}: ${done.status} · ${done.citations.length} citation(s)\n${done.text}\n`)
      expect(done.status).not.toBe('error')
      if (c.expect.status === 'answered') expect(done.status).toBe('answered')
      if (c.expect.status === 'no_sources') expect(['no_sources', 'refused']).toContain(done.status)
      for (const code of c.expect.citesProgram ?? []) expect(done.citations.map((x) => x.program_code), `cites ${code}`).toContain(code)
      for (const id of c.expect.citesDocument ?? []) expect(done.citations.map((x) => x.chunk_id), `cites chunk ${id}`).toContain(id)
      for (const re of c.expect.mentions ?? []) expect(done.text, `mentions ${re}`).toMatch(re)
      for (const re of c.expect.forbids ?? []) expect(done.text, `does not contain ${re}`).not.toMatch(re)
      if (c.expect.language === 'ar') expect(arabicShare(done.text)).toBeGreaterThan(0.6)
      if (c.expect.language === 'en') expect(arabicShare(done.text)).toBeLessThan(0.2)
    })
  }
})

describe.skipIf(enabled)('admissions assistant eval', () => {
  it('is skipped: set RUN_AI_EVALS=1 and ANTHROPIC_API_KEY to run it (it calls the Claude API and costs money)', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length)
  })
})
