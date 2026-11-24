'use client'

import { Mic, Square, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { recordVoiceUsage } from '@/lib/voice/actions'
import { speakableText, type VoiceProvider, type VoiceSurface } from '@/lib/voice/schemas'
import { cn } from '@/lib/utils'

/**
 * Voice controls for the chats (Phase 13), behind one interface with two providers:
 * - browser: the browser's own speech recognition and speech synthesis (no server cost; some
 *   browsers process speech on their maker's servers, which the page discloses);
 * - server: the university's contracted provider through /api/voice/[tenant]/… (budget and
 *   limits checked by the database).
 * Speech input only fills the message box: the person reviews and sends. Controls that the
 * browser cannot support are not shown.
 */

export type VoiceLabels = Record<'dictate' | 'listening' | 'stopListening' | 'readAloud' | 'stopReading' | 'denied' | 'failed', string>

export type VoiceConfig = {
  tenant: string
  surface: VoiceSurface
  provider: VoiceProvider
  input: boolean
  output: boolean
  /** BCP 47 tag, e.g. ar-SA or en-US. */
  lang: string
  locale: 'en' | 'ar'
  labels: VoiceLabels
}

type RecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionResultEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const noSubscribe = () => () => undefined

/** Whether this browser can do it (false during server rendering, so nothing flashes). */
function useSupport(check: () => boolean) {
  return useSyncExternalStore(noSubscribe, check, () => false)
}

const canDictateInBrowser = () => recognitionCtor() !== null
const canRecord = () => typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
const canSpeakInBrowser = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined'
const canPlay = () => typeof window !== 'undefined' && typeof window.Audio !== 'undefined'

/** Usage of the browser path, reported without waiting (never blocks the person). */
function report(config: VoiceConfig, kind: 'input' | 'output', amount: { seconds?: number; characters?: number }) {
  if (config.provider !== 'browser') return
  void recordVoiceUsage({ tenant: config.tenant, surface: config.surface, kind, ...amount }).catch(() => undefined)
}

const MAX_RECORDING_MS = 60_000

export function DictateButton({ config, onText, disabled }: { config: VoiceConfig; onText: (text: string) => void; disabled?: boolean }) {
  const supported = useSupport(config.provider === 'browser' ? canDictateInBrowser : canRecord)
  const [state, setState] = useState<'idle' | 'listening' | 'working'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  if (!supported || !config.input) return null

  function startBrowser() {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = config.lang
    recognition.interimResults = false
    recognition.continuous = false
    recognition.maxAlternatives = 1
    const started = Date.now()
    recognition.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
        .trim()
      if (text) onText(text)
    }
    recognition.onerror = (e) => setMessage(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? config.labels.denied : e.error === 'no-speech' || e.error === 'aborted' ? null : config.labels.failed)
    recognition.onend = () => {
      setState('idle')
      stopRef.current = null
      report(config, 'input', { seconds: Math.min(600, (Date.now() - started) / 1000) })
    }
    stopRef.current = () => recognition.stop()
    setMessage(null)
    setState('listening')
    try {
      recognition.start()
    } catch {
      setState('idle')
      setMessage(config.labels.failed)
    }
  }

  async function startServer() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setMessage(config.labels.denied)
      return
    }
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const timer = setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), MAX_RECORDING_MS)
    recorder.onstop = async () => {
      clearTimeout(timer)
      stream.getTracks().forEach((t) => t.stop())
      setState('working')
      try {
        const form = new FormData()
        form.set('audio', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), 'speech')
        form.set('surface', config.surface)
        form.set('locale', config.locale)
        const res = await fetch(`/api/voice/${encodeURIComponent(config.tenant)}/transcribe`, { method: 'POST', body: form })
        const body = (await res.json().catch(() => ({}))) as { text?: string }
        if (res.ok && body.text) onText(body.text)
        else setMessage(config.labels.failed)
      } catch {
        setMessage(config.labels.failed)
      } finally {
        setState('idle')
        stopRef.current = null
      }
    }
    stopRef.current = () => recorder.state !== 'inactive' && recorder.stop()
    setMessage(null)
    setState('listening')
    recorder.start()
  }

  const listening = state === 'listening'
  return (
    <span className="relative inline-flex">
      <Button
        type="button"
        variant={listening ? 'danger' : 'secondary'}
        size="icon"
        disabled={disabled || state === 'working'}
        aria-pressed={listening}
        aria-label={listening ? config.labels.stopListening : config.labels.dictate}
        title={listening ? config.labels.stopListening : config.labels.dictate}
        onClick={() => (listening ? stopRef.current?.() : config.provider === 'browser' ? startBrowser() : void startServer())}
      >
        {state === 'working' ? <Spinner className="size-4" /> : listening ? <Square aria-hidden /> : <Mic aria-hidden />}
      </Button>
      <span className="sr-only" aria-live="polite">
        {listening ? config.labels.listening : (message ?? '')}
      </span>
      {message ? (
        <span role="alert" className="absolute bottom-full mb-1 w-max max-w-64 rounded-md bg-danger px-2 py-1 text-xs text-white">
          {message}
        </span>
      ) : null}
    </span>
  )
}

export function ReadAloudButton({ config, text, className }: { config: VoiceConfig; text: string; className?: string }) {
  const supported = useSupport(config.provider === 'browser' ? canSpeakInBrowser : canPlay)
  const [speaking, setSpeaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  if (!supported || !config.output) return null
  const spoken = speakableText(text)
  if (!spoken) return null

  function speakBrowser() {
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(spoken)
    utterance.lang = config.lang
    const prefix = config.lang.slice(0, 2)
    const voice = synth.getVoices().find((v) => v.lang === config.lang) ?? synth.getVoices().find((v) => v.lang.startsWith(prefix))
    if (voice) utterance.voice = voice
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    stopRef.current = () => {
      synth.cancel()
      setSpeaking(false)
    }
    setSpeaking(true)
    synth.speak(utterance)
    report(config, 'output', { characters: spoken.length })
  }

  async function speakServer() {
    setBusy(true)
    try {
      const res = await fetch(`/api/voice/${encodeURIComponent(config.tenant)}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spoken, surface: config.surface, locale: config.locale }),
      })
      if (!res.ok) return
      const url = URL.createObjectURL(await res.blob())
      const audio = new Audio(url)
      const done = () => {
        setSpeaking(false)
        URL.revokeObjectURL(url)
      }
      audio.onended = done
      audio.onerror = done
      stopRef.current = () => {
        audio.pause()
        done()
      }
      setSpeaking(true)
      await audio.play()
    } catch {
      setSpeaking(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(speaking && 'text-primary', className)}
      disabled={busy}
      aria-pressed={speaking}
      onClick={() => (speaking ? stopRef.current?.() : config.provider === 'browser' ? speakBrowser() : void speakServer())}
    >
      {busy ? <Spinner className="size-4" /> : speaking ? <Square aria-hidden /> : <Volume2 aria-hidden />}
      <span className="sr-only sm:not-sr-only">{speaking ? config.labels.stopReading : config.labels.readAloud}</span>
    </Button>
  )
}
