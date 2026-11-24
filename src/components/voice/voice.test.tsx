import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recordVoiceUsage = vi.fn(async () => ({ status: 'success' as const, at: 0 }))
vi.mock('@/lib/voice/actions', () => ({ recordVoiceUsage: (...args: unknown[]) => recordVoiceUsage(...(args as [])) }))
const { DictateButton, ReadAloudButton } = await import('./voice-controls')

const labels = {
  dictate: 'Speak your question',
  listening: 'Listening',
  stopListening: 'Stop listening',
  readAloud: 'Read aloud',
  stopReading: 'Stop reading',
  denied: 'Microphone access was refused.',
  failed: 'Speech did not work.',
}
const config = { tenant: 'uni', surface: 'student_chat' as const, provider: 'browser' as const, input: true, output: true, lang: 'ar-SA', locale: 'ar' as const, labels }

type FakeRecognition = { lang: string; start: () => void; stop: () => void; onresult: ((e: unknown) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
let instances: FakeRecognition[] = []

beforeEach(() => {
  instances = []
  recordVoiceUsage.mockClear()
})
afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  delete (window as unknown as Record<string, unknown>).speechSynthesis
})

function installRecognition() {
  ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {
    lang = ''
    interimResults = true
    continuous = true
    maxAlternatives = 5
    onresult: ((e: unknown) => void) | null = null
    onend: (() => void) | null = null
    onerror: ((e: { error: string }) => void) | null = null
    start = vi.fn()
    stop = vi.fn(() => this.onend?.())
    constructor() {
      instances.push(this as unknown as FakeRecognition)
    }
  }
}

describe('DictateButton', () => {
  it('is not shown when the browser cannot recognize speech, or when input is off', () => {
    render(<DictateButton config={config} onText={() => undefined} />)
    expect(screen.queryByRole('button')).toBeNull()
    installRecognition()
    cleanup()
    render(<DictateButton config={{ ...config, input: false }} onText={() => undefined} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('listens in the interface language, fills the text, and reports only the duration', () => {
    installRecognition()
    const onText = vi.fn()
    render(<DictateButton config={config} onText={onText} />)
    fireEvent.click(screen.getByRole('button', { name: 'Speak your question' }))
    const rec = instances[0]!
    expect(rec.lang).toBe('ar-SA')
    expect(rec.start).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true')
    act(() => rec.onresult?.({ results: [Object.assign([{ transcript: 'أين المكتبة' }], { isFinal: true })] }))
    expect(onText).toHaveBeenCalledWith('أين المكتبة')
    act(() => rec.onend?.())
    expect(recordVoiceUsage).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'uni', surface: 'student_chat', kind: 'input', seconds: expect.any(Number) }))
    expect(JSON.stringify(recordVoiceUsage.mock.calls)).not.toContain('المكتبة') // no words are reported
  })

  it('explains a refused microphone', () => {
    installRecognition()
    render(<DictateButton config={config} onText={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Speak your question' }))
    act(() => instances[0]!.onerror?.({ error: 'not-allowed' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access was refused.')
  })
})

describe('ReadAloudButton', () => {
  it('reads the answer without citation markers, in the right language, and reports the characters', () => {
    const speak = vi.fn()
    ;(window as unknown as Record<string, unknown>).speechSynthesis = { speak, cancel: vi.fn(), getVoices: () => [{ lang: 'ar-SA', name: 'Arabic' }] }
    const Utterance = class {
      text: string
      lang = ''
      voice: unknown = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    ;(window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = Utterance
    render(<ReadAloudButton config={config} text="المكتبة مفتوحة حتى 16:00 [1]." />)
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
    const utterance = speak.mock.calls[0]![0] as InstanceType<typeof Utterance>
    expect(utterance.text).toBe('المكتبة مفتوحة حتى 16:00 .')
    expect(utterance.lang).toBe('ar-SA')
    expect(recordVoiceUsage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'output', characters: utterance.text.length }))
    expect(screen.getByRole('button', { name: 'Stop reading' })).toBeInTheDocument()
  })

  it('is not shown when output is off', () => {
    ;(window as unknown as Record<string, unknown>).speechSynthesis = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] }
    render(<ReadAloudButton config={{ ...config, output: false }} text="Hello" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
