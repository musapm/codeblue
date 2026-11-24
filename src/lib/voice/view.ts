import type { VoiceConfig } from '@/components/voice/voice-controls'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import type { VoiceStatus } from './queries'
import { speechLang, type VoiceSurface } from './schemas'

/** The chats' voice settings for this person, or undefined when voice is off for them. */
export function voiceConfig(dict: Dictionary, locale: 'en' | 'ar', tenant: string, surface: VoiceSurface, status: VoiceStatus | null): VoiceConfig | undefined {
  if (!status?.available || !status.withinBudget || !(status.input || status.output)) return undefined
  return { tenant, surface, provider: status.provider, input: status.input, output: status.output, lang: speechLang(locale), locale, labels: dict.voice.controls }
}
