import 'server-only'
import { logger } from '@/lib/logger'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import type { SpeechProvider } from './provider'
import { speakableText, type VoiceSurface } from './schemas'

/**
 * Server provider flow: gate (voice_begin: switch, budget, daily input limit) → the vendor →
 * book usage (voice_record; the database prices it with the university's own prices). Nothing
 * is stored but the usage figures.
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>
export type VoiceError = 'notConfigured' | 'forbidden' | 'invalid' | 'off' | 'budget' | 'limit' | 'failed'

const log = logger.child({ module: 'voice' })

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024
export const MAX_SPEAK_CHARS = 4000

function mapGate(code: string | undefined): VoiceError {
  if (code === '42501') return 'forbidden'
  if (code === '22023') return 'invalid'
  if (code === '55000') return 'off'
  if (code === '53400') return 'budget'
  if (code === '54000') return 'limit'
  return 'failed'
}

export async function transcribe(opts: {
  supabase: Supabase
  provider: SpeechProvider | null
  slug: string
  surface: VoiceSurface
  audio: Blob
  language: string
}): Promise<{ ok: true; text: string } | { ok: false; error: VoiceError }> {
  if (!opts.provider) return { ok: false, error: 'notConfigured' }
  if (opts.audio.size === 0 || opts.audio.size > MAX_AUDIO_BYTES) return { ok: false, error: 'invalid' }
  const gate = await opts.supabase.rpc('voice_begin', { p_tenant_slug: opts.slug, p_surface: opts.surface, p_kind: 'input' })
  if (gate.error) return { ok: false, error: mapGate(gate.error.code) }
  let result: { text: string; seconds: number }
  try {
    result = await opts.provider.transcribe(opts.audio, { language: opts.language })
  } catch (error) {
    log.error('voice.transcribe_failed', { provider: opts.provider.id, error })
    return { ok: false, error: 'failed' }
  }
  const seconds = Math.min(600, Math.max(0, Math.round(result.seconds * 100) / 100))
  const { error } = await opts.supabase.rpc('voice_record', { p_tenant_slug: opts.slug, p_surface: opts.surface, p_kind: 'input', p_provider: 'server', p_seconds: seconds, p_characters: 0 })
  if (error) log.error('voice.record_failed', { code: error.code })
  return { ok: true, text: result.text.trim().slice(0, 2000) }
}

export async function speak(opts: {
  supabase: Supabase
  provider: SpeechProvider | null
  slug: string
  surface: VoiceSurface
  text: string
  language: string
}): Promise<{ ok: true; audio: ArrayBuffer; mime: string } | { ok: false; error: VoiceError }> {
  if (!opts.provider) return { ok: false, error: 'notConfigured' }
  const text = speakableText(opts.text, MAX_SPEAK_CHARS)
  if (!text) return { ok: false, error: 'invalid' }
  const gate = await opts.supabase.rpc('voice_begin', { p_tenant_slug: opts.slug, p_surface: opts.surface, p_kind: 'output' })
  if (gate.error) return { ok: false, error: mapGate(gate.error.code) }
  let result: { audio: ArrayBuffer; mime: string }
  try {
    result = await opts.provider.synthesize(text, { language: opts.language })
  } catch (error) {
    log.error('voice.synthesize_failed', { provider: opts.provider.id, error })
    return { ok: false, error: 'failed' }
  }
  const { error } = await opts.supabase.rpc('voice_record', { p_tenant_slug: opts.slug, p_surface: opts.surface, p_kind: 'output', p_provider: 'server', p_seconds: 0, p_characters: text.length })
  if (error) log.error('voice.record_failed', { code: error.code })
  return { ok: true, audio: result.audio, mime: result.mime }
}
