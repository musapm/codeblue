import { z } from 'zod'
import { jsonError as fail } from '@/lib/ai/http'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getServerSpeechProvider } from '@/lib/voice/provider'
import { guardVoiceRequest, voiceFailure } from '@/lib/voice/route-helpers'
import { speechLang, VOICE_SURFACES } from '@/lib/voice/schemas'
import { MAX_SPEAK_CHARS, speak } from '@/lib/voice/server'

/**
 * Text to speech with the university's server provider (Phase 13). JSON: `text`, `surface`,
 * `locale`. Gate, vendor, usage (characters); the audio is returned, never stored.
 */
const bodySchema = z.object({ text: z.string().min(1).max(MAX_SPEAK_CHARS * 2), surface: z.enum(VOICE_SURFACES), locale: z.enum(['en', 'ar']) })

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const guard = await guardVoiceRequest(request)
  if (guard instanceof Response) return guard
  if (!request.headers.get('content-type')?.startsWith('application/json')) return fail(415, 'invalid')
  const { tenant } = await ctx.params
  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return fail(400, 'invalid')
    body = parsed.data
  } catch {
    return fail(400, 'invalid')
  }
  const result = await speak({
    supabase: await createSupabaseServerClient(),
    provider: getServerSpeechProvider(),
    slug: tenant,
    surface: body.surface,
    text: body.text,
    language: speechLang(body.locale),
  })
  return result.ok ? new Response(result.audio, { headers: { 'Content-Type': result.mime, 'Cache-Control': 'no-store' } }) : voiceFailure(result.error)
}
