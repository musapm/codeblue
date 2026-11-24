// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkAnswers, FieldsSchema, formatAnswer, keyFromLabel, parseFieldsJson, parseOptionLines, statusUpdateSchema, validDate, type FormField } from './schemas'

const state = vi.hoisted(() => ({
  configured: true,
  calls: [] as Record<string, unknown>[],
  response: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/ai/config', () => ({ getAiConfig: () => ({ configured: state.configured, model: 'claude-opus-5-5', effort: 'medium' }) }))
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500
  }
  class Anthropic {
    static APIError = APIError
    messages = {
      parse: async (params: Record<string, unknown>) => {
        state.calls.push(params)
        return state.response
      },
    }
  }
  return { default: Anthropic }
})

const { suggestRequest, WORKFLOW_SYSTEM } = await import('./ai')

const FIELDS: FormField[] = [
  { key: 'copies', type: 'number', label: 'Copies', required: true },
  { key: 'delivery', type: 'select', label: 'Delivery', required: true, options: [{ value: 'pickup', label: 'Pick up' }, { value: 'email', label: 'By email', label_ar: 'بالبريد' }] },
  { key: 'email', type: 'email', label: 'Email', required: false },
  { key: 'needed_by', type: 'date', label: 'Needed by', required: false },
  { key: 'notes', type: 'textarea', label: 'Notes', required: false },
  { key: 'confirm', type: 'checkbox', label: 'I confirm', required: true },
]
const FORMS = [
  { id: 'f1', versionId: 'v1', key: 'transcript', title: 'Official transcript', description: 'Copies of your <transcript>', fields: FIELDS },
  { id: 'f2', versionId: 'v2', key: 'leave', title: 'Leave of absence', description: null, fields: [{ key: 'reason', type: 'textarea', label: 'Reason', required: true }] as FormField[] },
]
const usage = { input_tokens: 1500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const message = (parsed: unknown, stop_reason = 'end_turn') => ({ model: 'claude-opus-5-5', stop_reason, usage, parsed_output: parsed, content: [] })

function fakeSupabase(beginError?: string) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  return {
    rpcs,
    names: () => rpcs.map((r) => r.fn),
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args })
        if (fn === 'workflow_ai_begin' && beginError) return { data: null, error: { code: beginError } }
        return { data: null, error: null }
      },
    } as never,
  }
}

beforeEach(() => {
  state.configured = true
  state.calls = []
  state.response = null
})

describe('answers (same rules as the database)', () => {
  it('normalizes valid answers and keeps ticked or unticked checkboxes', () => {
    expect(checkAnswers(FIELDS, { copies: ' 2 ', delivery: 'email', email: ' a@b.edu ', needed_by: '2026-12-15', notes: '', confirm: true })).toEqual({
      ok: true,
      answers: { copies: '2', delivery: 'email', email: 'a@b.edu', needed_by: '2026-12-15', confirm: true },
    })
  })

  it('reports required and invalid answers per field', () => {
    expect(checkAnswers(FIELDS, { copies: 'two', delivery: 'courier', email: 'nope', needed_by: '2026-02-30', confirm: false })).toEqual({
      ok: false,
      problems: { copies: 'invalid', delivery: 'invalid', email: 'invalid', needed_by: 'invalid', confirm: 'required' },
    })
    expect(checkAnswers(FIELDS, { confirm: true })).toEqual({ ok: false, problems: { copies: 'required', delivery: 'required' } })
    expect(checkAnswers([{ key: 'n', type: 'textarea', label: 'N', required: false }], { n: 'x'.repeat(4001) })).toEqual({ ok: false, problems: { n: 'invalid' } })
  })

  it('accepts only real dates between 1900 and 2100', () => {
    expect(validDate('2024-02-29')).toBe(true)
    expect(validDate('2026-02-29')).toBe(false)
    expect(validDate('1899-12-31')).toBe(false)
    expect(validDate('15/12/2026')).toBe(false)
  })

  it('formats answers for reading, in both languages', () => {
    expect(formatAnswer('ar', FIELDS[1]!, 'email', { yes: 'نعم', no: 'لا' })).toBe('بالبريد')
    expect(formatAnswer('en', FIELDS[5]!, true, { yes: 'Yes', no: 'No' })).toBe('Yes')
    expect(formatAnswer('en', FIELDS[3]!, '2026-12-15', { yes: 'Yes', no: 'No' })).toBe('December 15, 2026')
    expect(formatAnswer('en', FIELDS[2]!, undefined, { yes: 'Yes', no: 'No' })).toBe('')
  })
})

describe('form definitions', () => {
  it('accepts a valid form and refuses what the database refuses', () => {
    expect(FieldsSchema.safeParse(FIELDS).success).toBe(true)
    const bad = [
      [],
      [FIELDS[0], FIELDS[0]],
      [{ key: 'a', type: 'select', label: 'A', required: true }],
      [{ key: 'a', type: 'text', label: 'A', required: true, options: [{ value: 'x', label: 'X' }] }],
      [{ key: 'a', type: 'text', label: 'A', required: true, extra: 1 }],
      [{ key: 'A b', type: 'text', label: 'A', required: true }],
      [{ key: 'a', type: 'select', label: 'A', required: true, options: [{ value: 'x', label: 'X' }, { value: 'x', label: 'Y' }] }],
    ]
    for (const fields of bad) expect(FieldsSchema.safeParse(fields).success).toBe(false)
    expect(parseFieldsJson('not json')).toBeNull()
    expect(parseFieldsJson(JSON.stringify(FIELDS))).toHaveLength(6)
  })

  it('makes keys from labels once, unique, ASCII only', () => {
    expect(keyFromLabel('Number of copies', new Set())).toBe('number_of_copies')
    expect(keyFromLabel('Number of copies', new Set(['number_of_copies']))).toBe('number_of_copies_2')
    expect(keyFromLabel('عدد النسخ', new Set())).toBe('field')
    expect(keyFromLabel('2nd address', new Set())).toBe('nd_address')
  })

  it('reads choices one per line with an optional Arabic label, keeping earlier values', () => {
    const options = parseOptionLines('Pick up | استلام\nBy email\n\n')
    expect(options).toEqual([
      { value: 'pick-up', label: 'Pick up', label_ar: 'استلام' },
      { value: 'by-email', label: 'By email', label_ar: null },
    ])
    expect(parseOptionLines('By email\nPick up', [{ value: 'email', label: 'By email' }]).map((o) => o.value)).toEqual(['email', 'pick-up'])
  })

  it('a status change to "needs information" or "rejected" needs a message', () => {
    const base = { requestId: '11111111-1111-4111-8111-111111111111' }
    expect(statusUpdateSchema.safeParse({ ...base, status: 'needs_info', message: '' }).success).toBe(false)
    expect(statusUpdateSchema.safeParse({ ...base, status: 'rejected', message: 'No' }).success).toBe(false)
    expect(statusUpdateSchema.safeParse({ ...base, status: 'rejected', message: 'Outside the deadline.' }).success).toBe(true)
    expect(statusUpdateSchema.safeParse({ ...base, status: 'approved' }).success).toBe(true)
  })
})

describe('suggestRequest (the workflow agent)', () => {
  const run = (client: never, text = 'I need 2 copies of my transcript by email to a@b.edu before 15 December') => suggestRequest({ supabase: client, slug: 'uni', text, forms: FORMS, today: '2026-11-24' })

  it('does nothing without the AI key, and stops at the gate without calling the model', async () => {
    state.configured = false
    expect(await run(fakeSupabase().client)).toEqual({ ok: false, error: 'notConfigured' })
    state.configured = true
    for (const [code, error] of [
      ['55000', 'disabled'],
      ['53400', 'aiBudget'],
      ['54000', 'dailyLimit'],
      ['42501', 'forbidden'],
    ] as const) {
      const { client, names } = fakeSupabase(code)
      expect(await run(client)).toEqual({ ok: false, error })
      expect(names()).toEqual(['workflow_ai_begin'])
    }
    expect(state.calls).toHaveLength(0)
  })

  it('picks the form, keeps only values that fit, never ticks checkboxes, and lists what is still needed', async () => {
    const { client, rpcs, names } = fakeSupabase()
    state.response = message({
      form_key: 'transcript',
      answers: [
        { key: 'copies', value: '2' },
        { key: 'delivery', value: 'By email' }, // a label: mapped to the option value
        { key: 'email', value: 'a@b.edu' },
        { key: 'needed_by', value: '15 December' }, // not YYYY-MM-DD: dropped
        { key: 'confirm', value: 'true' }, // checkboxes are never filled
        { key: 'unknown', value: 'x' },
        { key: 'copies', value: '9' }, // duplicates: the first counts
      ],
      note: 'The official transcript form fits. Please confirm the details.',
    })
    const result = await run(client)
    expect(result).toEqual({
      ok: true,
      suggestion: { formId: 'f1', answers: { copies: '2', delivery: 'email', email: 'a@b.edu' }, missing: [], note: 'The official transcript form fits. Please confirm the details.' },
    })
    expect(names()).toEqual(['workflow_ai_begin', 'workflow_ai_record'])
    expect(rpcs[1]!.args).toMatchObject({ p_tenant_slug: 'uni', p_model: 'claude-opus-5-5' })
    const call = state.calls[0]!
    expect(call.system).toBe(WORKFLOW_SYSTEM)
    expect(call.output_config).toMatchObject({ effort: 'low' })
    const content = String((call.messages as { content: string }[])[0]!.content)
    expect(content).toContain('<form key="transcript" title="Official transcript">\nCopies of your &lt;transcript&gt;')
    expect(content).toContain('- delivery (select, required; options: pickup = Pick up, email = By email): Delivery')
    expect(content).toContain('Today: 2026-11-24')
  })

  it('lists required fields the description did not give', async () => {
    const { client } = fakeSupabase()
    state.response = message({ form_key: 'transcript', answers: [{ key: 'delivery', value: 'pickup' }], note: 'n' })
    const result = await run(client)
    expect(result.ok && result.suggestion.missing).toEqual(['copies'])
  })

  it('says so when no form fits, and books usage for refusals too', async () => {
    const { client } = fakeSupabase()
    state.response = message({ form_key: 'parking-permit', answers: [{ key: 'x', value: 'y' }], note: 'No form fits.' })
    expect(await run(client)).toEqual({ ok: true, suggestion: { formId: null, answers: {}, missing: [], note: 'No form fits.' } })
    const refused = fakeSupabase()
    state.response = message(null, 'refusal')
    expect(await run(refused.client)).toEqual({ ok: false, error: 'aiRefused' })
    expect(refused.names()).toEqual(['workflow_ai_begin', 'workflow_ai_record'])
  })
})
