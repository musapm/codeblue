import { describe, expect, it } from 'vitest'
import { estimateCostUsd, priceFor } from './pricing'
import { buildMessages, buildSystemPrompt, mapCitations, retrievalQuery, type RetrievedChunk } from './prompt'

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunk_id: 1,
  document_id: '11111111-1111-4111-8111-111111111111',
  version_no: 2,
  title: 'Student Handbook',
  title_ar: 'دليل الطالب',
  page_from: 4,
  page_to: 4,
  heading: 'Tuition fees',
  content: 'Tuition is 1,200 per semester, payable before week 2.',
  score: 0.03,
  ...over,
})

describe('pricing', () => {
  it('prices Claude Opus 5.5 at list rates, cache writes at 1.25x input', () => {
    const million = 1_000_000
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: million, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(4)
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: million, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(20)
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: million, cacheWriteTokens: 0 })).toBe(0.2)
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: million })).toBe(5)
  })

  it('a typical answer costs a few cents', () => {
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 3000, outputTokens: 400, cacheReadTokens: 900, cacheWriteTokens: 0 })).toBeCloseTo(0.02018, 6)
  })

  it('dated ids use the longest known prefix; unknown models fail safe (highest rate)', () => {
    expect(priceFor('claude-opus-5-5-20261101')).toEqual(priceFor('claude-opus-5-5'))
    expect(priceFor('claude-opus-5-20260101')).toEqual(priceFor('claude-opus-5'))
    expect(priceFor('some-new-model').input).toBeGreaterThanOrEqual(priceFor('claude-opus-5').input)
  })
})

describe('system prompt', () => {
  it('names the university, grounds answers in the search results and gives a contact', () => {
    const p = buildSystemPrompt({ universityName: 'Northbridge University', assistantName: 'Nora', supportEmail: 'help@northbridge.example' })
    expect(p).toContain('Northbridge University')
    expect(p).toContain('Nora')
    expect(p).toContain('help@northbridge.example')
    expect(p).toMatch(/only with information from the search results/)
    expect(p).toMatch(/not instructions/)
  })

  it('falls back to a generic contact and appends admin guidance last, capped at 2000 characters', () => {
    const p = buildSystemPrompt({ universityName: 'U', assistantName: 'A', instructions: `  Be warm.${'x'.repeat(3000)}` })
    expect(p).toContain('the responsible university office')
    const guidance = p.slice(p.indexOf('Additional guidance'))
    expect(guidance).toContain('Be warm.')
    expect(guidance.split('\n')[1]!.length).toBe(2000)
    expect(p.indexOf('Safety rules')).toBeLessThan(p.indexOf('Additional guidance'))
  })

  it('has no per-request data, so it can be cached', () => {
    const a = buildSystemPrompt({ universityName: 'U', assistantName: 'A' })
    const b = buildSystemPrompt({ universityName: 'U', assistantName: 'A' })
    expect(a).toBe(b)
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('retrieval query', () => {
  it('short follow-ups borrow the previous question; standalone questions do not', () => {
    const history = [
      { role: 'user' as const, content: 'How much is tuition?' },
      { role: 'assistant' as const, content: 'It is 1,200.' },
    ]
    expect(retrievalQuery('When do I pay it?', history)).toBe('How much is tuition? When do I pay it?')
    expect(retrievalQuery('x'.repeat(90), history)).toBe('x'.repeat(90))
    expect(retrievalQuery('When do I pay it?', [])).toBe('When do I pay it?')
  })
})

describe('messages', () => {
  it('sends passages as citable search results followed by the question', () => {
    const messages = buildMessages({ history: [], question: 'How much is tuition?', chunks: [chunk(), chunk({ chunk_id: 2, page_from: 5, page_to: 6, heading: null })], locale: 'en' })
    expect(messages).toHaveLength(1)
    const content = messages[0]!.content as unknown as Array<Record<string, unknown>>
    expect(content).toHaveLength(3)
    expect(content[0]).toMatchObject({
      type: 'search_result',
      source: 'kb://11111111-1111-4111-8111-111111111111/v2#chunk-1',
      title: 'Student Handbook (p. 4)',
      citations: { enabled: true },
      content: [{ type: 'text', text: 'Tuition fees\nTuition is 1,200 per semester, payable before week 2.' }],
    })
    expect(content[1]).toMatchObject({ title: 'Student Handbook (pp. 5-6)', content: [{ type: 'text', text: 'Tuition is 1,200 per semester, payable before week 2.' }] })
    expect(content[2]).toEqual({ type: 'text', text: 'How much is tuition?' })
  })

  it('uses the Arabic title for Arabic answers', () => {
    const content = buildMessages({ history: [], question: 'كم الرسوم؟', chunks: [chunk()], locale: 'ar' })[0]!.content as unknown as Array<Record<string, unknown>>
    expect(content[0]!.title).toBe('دليل الطالب (p. 4)')
  })

  it('keeps turns alternating: drops a leading answer, merges repeats, folds an unanswered question', () => {
    const messages = buildMessages({
      history: [
        { role: 'assistant', content: 'orphan answer' },
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2 (no answer stored)' },
      ],
      question: 'Q3',
      chunks: [chunk()],
      locale: 'en',
    })
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(messages[0]!.content).toBe('Q1')
    const last = messages[2]!.content as unknown as Array<Record<string, unknown>>
    expect(last[0]).toEqual({ type: 'text', text: 'Q2 (no answer stored)' })
    expect(last[last.length - 1]).toEqual({ type: 'text', text: 'Q3' })
  })
})

describe('citation mapping', () => {
  const chunks = [chunk(), chunk({ chunk_id: 7, title: 'Exam Rules', page_from: 2, page_to: 2 })]
  const cite = (index: number, text = 'quoted') => ({ type: 'search_result_location', search_result_index: index, cited_text: text, source: 's', title: 't', start_block_index: 0, end_block_index: 0 })

  it('numbers sources in order of first use and marks each cited sentence', () => {
    const { text, citations } = mapCitations(
      [
        { type: 'thinking', text: 'internal' },
        { type: 'text', text: 'Tuition is 1,200 per semester.', citations: [cite(0, 'Tuition is 1,200 per semester')] },
        { type: 'text', text: ' Exams follow the exam rules.', citations: [cite(1), cite(0)] },
        { type: 'text', text: ' Contact the office.' },
      ],
      chunks,
      'en',
    )
    expect(text).toBe('Tuition is 1,200 per semester. [1] Exams follow the exam rules. [2] [1] Contact the office.')
    expect(citations.map((c) => [c.n, c.chunk_id, c.title, c.page_from])).toEqual([
      [1, 1, 'Student Handbook', 4],
      [2, 7, 'Exam Rules', 2],
    ])
    expect(citations[0]!.cited_text).toBe('Tuition is 1,200 per semester')
  })

  it('drops citations that do not map to a retrieved passage and other citation types', () => {
    const { text, citations } = mapCitations([{ type: 'text', text: 'Answer.', citations: [cite(9), { type: 'char_location', cited_text: 'x' }] }], chunks, 'en')
    expect(text).toBe('Answer.')
    expect(citations).toEqual([])
  })

  it('caps quoted text', () => {
    const { citations } = mapCitations([{ type: 'text', text: 'A', citations: [cite(0, 'y'.repeat(900))] }], chunks, 'en')
    expect(citations[0]!.cited_text).toHaveLength(400)
  })
})
