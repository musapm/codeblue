// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDayTime, locationSchema, openStatus, parseDayRanges, projectPoints, toLocationPayload, type Hours } from './schemas'

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

const { askCampus, describeLocation, CAMPUS_SYSTEM } = await import('./ai')

const HOURS: Hours = { sun: [['08:00', '16:00']], mon: [['08:00', '12:00'], ['13:00', '16:00']], tue: [['08:00', '16:00']] }
// Tuesday 24 Nov 2026, 12:30 in Khartoum (UTC+2) = 10:30 UTC.
const TUE_1230 = new Date('2026-11-24T10:30:00Z')

describe('opening hours', () => {
  it('reads day ranges typed by people, and refuses the rest', () => {
    expect(parseDayRanges('8:00-12:00, 13:00 – 16:00')).toEqual([
      ['08:00', '12:00'],
      ['13:00', '16:00'],
    ])
    expect(parseDayRanges('')).toEqual([])
    expect(parseDayRanges('20:00-24:00')).toEqual([['20:00', '24:00']])
    for (const bad of ['16:00-08:00', '8-12', '25:00-26:00', '08:00-09:00, 10:00-11:00, 12:00-13:00, 14:00-15:00', 'all day']) expect(parseDayRanges(bad)).toBeNull()
  })

  it('knows the weekday and time in the university’s time zone', () => {
    expect(localDayTime('Africa/Khartoum', TUE_1230)).toEqual({ day: 'tue', time: '12:30' })
    expect(localDayTime('UTC', TUE_1230)).toEqual({ day: 'tue', time: '10:30' })
    expect(localDayTime('Not/AZone', TUE_1230)).toEqual({ day: 'tue', time: '10:30' })
  })

  it('says open until, closed until the next opening, or unknown', () => {
    expect(openStatus(HOURS, 'Africa/Khartoum', TUE_1230)).toEqual({ state: 'open', until: '16:00' })
    // Monday 12:30 (lunch break) in UTC+2 → 10:30 UTC on 2026-11-23.
    expect(openStatus(HOURS, 'Africa/Khartoum', new Date('2026-11-23T10:30:00Z'))).toEqual({ state: 'closed', opens: { day: 'mon', time: '13:00', today: true } })
    // Tuesday 18:00 → next opening Sunday 08:00.
    expect(openStatus(HOURS, 'Africa/Khartoum', new Date('2026-11-24T16:00:00Z'))).toEqual({ state: 'closed', opens: { day: 'sun', time: '08:00', today: false } })
    expect(openStatus(null, 'UTC', TUE_1230)).toEqual({ state: 'unknown' })
    expect(openStatus({}, 'UTC', TUE_1230)).toEqual({ state: 'closed', opens: null })
  })
})

describe('the simple map', () => {
  it('projects coordinates into the box, north up, keeping proportions', () => {
    const pts = projectPoints(
      [
        { id: 'a', lat: 15.59, lon: 32.53 },
        { id: 'b', lat: 15.6, lon: 32.53 },
        { id: 'c', lat: 15.59, lon: 32.54 },
      ],
      800,
      480,
      40,
    )
    const [a, b, c] = pts
    expect(b!.y).toBeLessThan(a!.y) // north is up
    expect(c!.x).toBeGreaterThan(a!.x) // east is right
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(40)
      expect(p.x).toBeLessThanOrEqual(760)
      expect(p.y).toBeGreaterThanOrEqual(40)
      expect(p.y).toBeLessThanOrEqual(440)
    }
    expect(projectPoints([{ id: 'only', lat: 1, lon: 2 }], 800, 480, 40)).toEqual([{ id: 'only', x: 400, y: 240 }])
    expect(projectPoints([], 800, 480, 40)).toEqual([])
  })
})

describe('the location form', () => {
  const base = { kind: 'office', name: 'Registrar’s Office' }

  it('turns form fields into the stored shape', () => {
    const parsed = locationSchema.parse({
      ...base,
      hoursKnown: 'on',
      hours_mon: '08:00-12:00, 13:00-16:00',
      hours_fri: '',
      access_elevator: 'yes',
      access_hearing_loop: 'no',
      access_braille_signage: '',
      latitude: '15.5912',
      longitude: '32.5341',
      email: 'Registry@Uni.EDU',
      aliases: 'transcripts, مكتب التسجيل\ncertificates',
      parentId: '',
    })
    expect(toLocationPayload(parsed)).toMatchObject({
      kind: 'office',
      opening_hours: { mon: [['08:00', '12:00'], ['13:00', '16:00']] },
      accessibility: { elevator: true, hearing_loop: false },
      latitude: '15.5912',
      email: 'registry@uni.edu',
      aliases: ['transcripts', 'مكتب التسجيل', 'certificates'],
      parent_id: null,
    })
    expect(toLocationPayload(locationSchema.parse({ ...base, hours_mon: '08:00-12:00' })).opening_hours).toBeNull() // hours not known
  })

  it('refuses what the database refuses', () => {
    const problem = (v: Record<string, unknown>) => locationSchema.safeParse({ ...base, ...v }).error?.issues.map((i) => i.message)
    expect(problem({ hoursKnown: 'on', hours_tue: '9 to 5' })).toEqual(['campusHours'])
    expect(problem({ latitude: '15.5' })).toEqual(['campusCoordinates'])
    expect(problem({ latitude: '95', longitude: '32' })).toEqual(['campusCoordinates'])
    expect(problem({ phone: 'call me' })).toEqual(['phoneInvalid'])
    expect(problem({ url: 'http://x.example' })).toEqual(['urlInvalid'])
    expect(problem({ code: '#1' })).toEqual(['campusCode'])
    expect(problem({ name: 'X' })).toEqual(['nameRequired'])
  })
})

describe('askCampus', () => {
  const location = {
    id: 'l1',
    tenant_id: 't',
    kind: 'office' as const,
    name: 'Registrar’s Office',
    name_ar: 'مكتب التسجيل',
    code: 'R1',
    description: 'Transcripts and certificates <b>here</b>',
    description_ar: null,
    parent_id: 'b1',
    floor: '1',
    department_id: null,
    latitude: null,
    longitude: null,
    hours: HOURS,
    hours_note: 'Closed on public holidays',
    hours_note_ar: null,
    access: { elevator: true, step_free_entrance: false },
    accessibility_note: null,
    accessibility_note_ar: null,
    phone: '+249 123 456',
    email: null,
    url: null,
    aliases: [],
    published: true,
    created_at: '',
    updated_at: '',
  }
  const usage = { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  function fake(beginError?: string) {
    const rpcs: string[] = []
    return {
      rpcs,
      client: {
        rpc: async (fn: string) => {
          rpcs.push(fn)
          return fn === 'campus_ai_begin' && beginError ? { data: null, error: { code: beginError } } : { data: null, error: null }
        },
      } as never,
    }
  }
  const ask = (client: never, matches = [location]) =>
    askCampus({ supabase: client, slug: 'uni', question: 'Is the registrar open now?', matches, buildings: new Map([['b1', 'Main Building']]), timeZone: 'Africa/Khartoum', now: TUE_1230 })

  beforeEach(() => {
    state.configured = true
    state.calls = []
    state.response = null
  })

  it('gives the model facts, including whether it is open now, computed by the app', () => {
    const text = describeLocation(location, 1, 'Main Building', 'Africa/Khartoum', TUE_1230)
    expect(text).toContain('<record n="1">')
    expect(text).toContain('In building: Main Building')
    expect(text).toContain('Now: open, until 16:00')
    expect(text).toContain('Hours: mon 08:00-12:00, 13:00-16:00; tue 08:00-16:00; wed closed')
    expect(text).toContain('elevator: yes; accessible toilet: not recorded')
    expect(text).toContain('step free entrance: no')
    expect(text).toContain('&lt;b&gt;here&lt;/b&gt;')
  })

  it('needs the key and passes the gate before anything else; no records means no model call', async () => {
    state.configured = false
    expect(await ask(fake().client)).toEqual({ ok: false, error: 'notConfigured' })
    state.configured = true
    for (const [code, error] of [
      ['55000', 'disabled'],
      ['53400', 'aiBudget'],
      ['54000', 'dailyLimit'],
    ] as const) {
      const f = fake(code)
      expect(await ask(f.client)).toEqual({ ok: false, error })
      expect(f.rpcs).toEqual(['campus_ai_begin'])
    }
    const none = fake()
    expect(await ask(none.client, [])).toEqual({ ok: true, result: { answer: null, locations: [] } })
    expect(state.calls).toHaveLength(0)
  })

  it('answers with the records it used and books usage, also for refusals', async () => {
    const f = fake()
    state.response = { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage, parsed_output: { answer: 'Yes, it is open until 16:00, on floor 1 of the Main Building.', locations: [1, 1, 7] } }
    expect(await ask(f.client)).toEqual({
      ok: true,
      result: { answer: 'Yes, it is open until 16:00, on floor 1 of the Main Building.', locations: [{ id: 'l1', name: 'Registrar’s Office', name_ar: 'مكتب التسجيل' }] },
    })
    expect(f.rpcs).toEqual(['campus_ai_begin', 'campus_ai_record'])
    expect(state.calls[0]!.system).toBe(CAMPUS_SYSTEM)
    expect(state.calls[0]!.output_config).toMatchObject({ effort: 'low' })
    const refused = fake()
    state.response = { model: 'claude-opus-5-5', stop_reason: 'refusal', usage, parsed_output: null }
    expect(await ask(refused.client)).toEqual({ ok: false, error: 'aiRefused' })
    expect(refused.rpcs).toEqual(['campus_ai_begin', 'campus_ai_record'])
  })
})
