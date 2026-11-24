import { jsonError as fail } from '@/lib/ai/http'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getServerSpeechProvider } from '@/lib/voice/provider'
import { guardVoiceRequest, voiceFailure } from '@/lib/voice/route-helpers'
import { speechLang, VOICE_SURFACES, type VoiceSurface } from '@/lib/voice/schemas'
import { MAX_AUDIO_BYTES, transcribe } from '@/lib/voice/server'

/**
 * Speech to text with the university's server provider (Phase 13). Multipart: `audio` (at most
 * 2 MB), `surface`, `locale`. The database gate (voice_begin) checks the switch, the budget and
 * the daily limit; usage is booked after the vendor answers. No audio is stored.
 */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const guard = await guardVoiceRequest(request)
  if (guard instanceof Response) return guard
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) return fail(415, 'invalid')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_AUDIO_BYTES + 64 * 1024) return fail(413, 'invalid')
  const { tenant } = await ctx.params
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, 'invalid')
  }
  const audio = form.get('audio')
  const surface = String(form.get('surface') ?? '')
  if (!(audio instanceof Blob) || !(VOICE_SURFACES as readonly string[]).includes(surface)) return fail(400, 'invalid')
  const result = await transcribe({
    supabase: await createSupabaseServerClient(),
    provider: getServerSpeechProvider(),
    slug: tenant,
    surface: surface as VoiceSurface,
    audio,
    language: speechLang(String(form.get('locale') ?? 'en')),
  })
  return result.ok ? Response.json({ text: result.text }, { headers: { 'Cache-Control': 'no-store' } }) : voiceFailure(result.error)
}
