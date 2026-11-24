import 'server-only'

/**
 * The server speech provider interface (Phase 13). A university that chooses the 'server'
 * provider sends speech and text to a contracted vendor through this interface. No vendor is
 * connected yet: which one (Arabic quality, data handling, price) is a decision for the
 * product owner (docs/voice.md), and each needs its own key. Until then
 * getServerSpeechProvider() returns null and the voice endpoints answer "not configured".
 */
export interface SpeechProvider {
  readonly id: string
  /** Speech to text. `seconds` is the audio length the vendor billed (or measured). */
  transcribe(audio: Blob, opts: { language: string }): Promise<{ text: string; seconds: number }>
  /** Text to speech. */
  synthesize(text: string, opts: { language: string }): Promise<{ audio: ArrayBuffer; mime: string }>
}

type Factory = (env: NodeJS.ProcessEnv) => SpeechProvider | null

/** Vendor adapters register here once one is chosen (e.g. `acme: (env) => new AcmeSpeech(env.ACME_KEY)`). */
const FACTORIES: Record<string, Factory> = {}

export function getServerSpeechProvider(env: NodeJS.ProcessEnv = process.env): SpeechProvider | null {
  const id = env.VOICE_PROVIDER?.trim()
  if (!id) return null
  const factory = FACTORIES[id]
  return factory ? factory(env) : null
}
