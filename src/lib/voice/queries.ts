import 'server-only'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { VoiceProvider, VoiceSurface } from './schemas'

const log = logger.child({ module: 'voice' })

function fail(op: string, error: { code?: string }): never {
  log.error('voice.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type VoiceStatus = { available: boolean; input: boolean; output: boolean; provider: VoiceProvider; withinBudget: boolean }

/** Never throws: voice is an extra, a chat must still open without it. */
export async function getVoiceStatus(slug: string, surface: VoiceSurface): Promise<VoiceStatus | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('voice_status', { p_tenant_slug: slug, p_surface: surface })
    if (error) {
      log.warn('voice.status_failed', { code: error.code })
      return null
    }
    const s = (data ?? {}) as Record<string, unknown>
    return { available: s.available === true, input: s.input === true, output: s.output === true, provider: s.provider === 'server' ? 'server' : 'browser', withinBudget: s.within_budget === true }
  } catch (error) {
    log.warn('voice.status_failed', { error })
    return null
  }
}

export type VoiceSettings = {
  enabled: boolean
  inputEnabled: boolean
  outputEnabled: boolean
  provider: VoiceProvider
  inputPrice: number | null
  outputPrice: number | null
  monthlyBudgetUsd: number
  dailyMinutes: number
}

/** Defaults (no row yet) match the table: off, browser, no prices, 5 USD, 10 minutes a day. */
export async function getVoiceSettings(tenantId: string): Promise<VoiceSettings> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('voice_settings').select('*').eq('tenant_id', tenantId).maybeSingle()
  if (error) fail('voice_settings', error)
  if (!data) return { enabled: false, inputEnabled: true, outputEnabled: true, provider: 'browser', inputPrice: null, outputPrice: null, monthlyBudgetUsd: 5, dailyMinutes: 10 }
  return {
    enabled: data.enabled,
    inputEnabled: data.input_enabled,
    outputEnabled: data.output_enabled,
    provider: data.provider === 'server' ? 'server' : 'browser',
    inputPrice: data.input_price_per_minute === null ? null : Number(data.input_price_per_minute),
    outputPrice: data.output_price_per_1k_chars === null ? null : Number(data.output_price_per_1k_chars),
    monthlyBudgetUsd: Number(data.monthly_budget_usd),
    dailyMinutes: Math.round(data.daily_input_seconds / 60),
  }
}

export type VoiceUsage = { inputMinutes: number; inputUses: number; outputCharacters: number; outputUses: number; people: number; costUsd: number; unpriced: number }

export async function getVoiceUsage(slug: string): Promise<VoiceUsage> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('voice_usage', { p_tenant_slug: slug })
  if (error) fail('voice_usage', error)
  const u = (data ?? {}) as Record<string, unknown>
  const n = (k: string) => Number(u[k] ?? 0)
  return { inputMinutes: n('input_minutes'), inputUses: n('input_uses'), outputCharacters: n('output_characters'), outputUses: n('output_uses'), people: n('people'), costUsd: n('cost_usd'), unpriced: n('unpriced') }
}
