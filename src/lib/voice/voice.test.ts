// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getServerSpeechProvider, type SpeechProvider } from './provider'
import { speakableText, speechLang, voiceSettingsSchema, voiceUsageSchema } from './schemas'
import { speak, transcribe } from './server'

function fakeSupabase(gateError?: string) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  return {
    rpcs,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args })
        return fn === 'voice_begin' && gateError ? { data: null, error: { code: gateError } } : { data: null, error: null }
      },
    } as never,
  }
}

const provider = (overrides: Partial<SpeechProvider> = {}): SpeechProvider => ({
  id: 'fake',
  transcribe: async () => ({ text: '  Where is the library?  ', seconds: 4.567 }),
  synthesize: async () => ({ audio: new ArrayBuffer(8), mime: 'audio/mpeg' }),
  ...overrides,
})
const audio = new Blob([new Uint8Array(100)], { type: 'audio/webm' })

describe('voice rules', () => {
  it('reads answers without citation markers or list dashes', () => {
    expect(speakableText('Fees are due on 1 March [1].\n- Pay online [2]\n- Or at the bank')).toBe('Fees are due on 1 March .\nPay online\nOr at the bank')
    expect(speakableText('a'.repeat(5000))).toHaveLength(4000)
    expect(speechLang('ar')).toBe('ar-SA')
    expect(speechLang('en')).toBe('en-US')
  })

  it('settings: prices are optional and bounded; minutes are whole', () => {
    const base = { provider: 'server', monthlyBudget: '5', dailyMinutes: '10' }
    expect(voiceSettingsSchema.parse({ ...base, enabled: 'on', inputPrice: '0.006', outputPrice: '' })).toMatchObject({ enabled: true, inputEnabled: false, inputPrice: 0.006, outputPrice: null })
    const err = (v: Record<string, unknown>) => voiceSettingsSchema.safeParse({ ...base, ...v }).error?.issues[0]?.message
    expect(err({ inputPrice: '-1' })).toBe('voicePrice')
    expect(err({ outputPrice: 'cheap' })).toBe('voicePrice')
    expect(err({ dailyMinutes: '1.5' })).toBe('voiceMinutes')
    expect(err({ provider: 'cloud' })).toBeDefined()
  })

  it('usage reports are bounded', () => {
    expect(voiceUsageSchema.safeParse({ tenant: 'uni', surface: 'student_chat', kind: 'input', seconds: 12 }).success).toBe(true)
    expect(voiceUsageSchema.safeParse({ tenant: 'uni', surface: 'student_chat', kind: 'input', seconds: 601 }).success).toBe(false)
    expect(voiceUsageSchema.safeParse({ tenant: 'uni', surface: 'admissions', kind: 'input' }).success).toBe(false)
  })

  it('no server provider is connected without a configured, known adapter', () => {
    expect(getServerSpeechProvider({} as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(getServerSpeechProvider({ VOICE_PROVIDER: 'unknown-vendor' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('the server provider flow', () => {
  const base = { slug: 'uni', surface: 'student_chat' as const, language: 'en-US' }

  it('says "not configured" without a provider, before touching the database', async () => {
    const f = fakeSupabase()
    expect(await transcribe({ supabase: f.client, provider: null, audio, ...base })).toEqual({ ok: false, error: 'notConfigured' })
    expect(await speak({ supabase: f.client, provider: null, text: 'Hi', ...base })).toEqual({ ok: false, error: 'notConfigured' })
    expect(f.rpcs).toHaveLength(0)
  })

  it('maps the gate: switch, budget, daily limit, permission', async () => {
    for (const [code, error] of [
      ['55000', 'off'],
      ['53400', 'budget'],
      ['54000', 'limit'],
      ['42501', 'forbidden'],
    ] as const) {
      const f = fakeSupabase(code)
      expect(await transcribe({ supabase: f.client, provider: provider(), audio, ...base })).toEqual({ ok: false, error })
      expect(f.rpcs.map((r) => r.fn)).toEqual(['voice_begin'])
    }
  })

  it('transcribes, then books the seconds; refuses empty or oversized audio', async () => {
    const f = fakeSupabase()
    expect(await transcribe({ supabase: f.client, provider: provider(), audio, ...base })).toEqual({ ok: true, text: 'Where is the library?' })
    expect(f.rpcs.map((r) => r.fn)).toEqual(['voice_begin', 'voice_record'])
    expect(f.rpcs[0]!.args).toEqual({ p_tenant_slug: 'uni', p_surface: 'student_chat', p_kind: 'input' })
    expect(f.rpcs[1]!.args).toEqual({ p_tenant_slug: 'uni', p_surface: 'student_chat', p_kind: 'input', p_provider: 'server', p_seconds: 4.57, p_characters: 0 })
    expect((await transcribe({ supabase: f.client, provider: provider(), audio: new Blob([]), ...base })).ok).toBe(false)
    expect((await transcribe({ supabase: f.client, provider: provider(), audio: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]), ...base })).ok).toBe(false)
  })

  it('a vendor failure books nothing', async () => {
    const f = fakeSupabase()
    const failing = provider({ transcribe: async () => Promise.reject(new Error('down')) })
    expect(await transcribe({ supabase: f.client, provider: failing, audio, ...base })).toEqual({ ok: false, error: 'failed' })
    expect(f.rpcs.map((r) => r.fn)).toEqual(['voice_begin'])
  })

  it('reads the cleaned text aloud and books its characters', async () => {
    const f = fakeSupabase()
    const result = await speak({ supabase: f.client, provider: provider(), text: 'Open until 16:00 [1].', ...base })
    expect(result).toMatchObject({ ok: true, mime: 'audio/mpeg' })
    expect(f.rpcs[1]!.args).toMatchObject({ p_kind: 'output', p_characters: 'Open until 16:00 .'.length })
    expect(await speak({ supabase: f.client, provider: provider(), text: ' [1] ', ...base })).toEqual({ ok: false, error: 'invalid' })
  })
})
