import { z } from 'zod'
import { answerQuestion } from '@/lib/ai/assistant'
import { ARABIC, isSameOrigin, jsonError as fail, ndjsonResponse } from '@/lib/ai/http'
import { programToChunk, selectPrograms } from '@/lib/admissions/public'
import { getPublicAdmissions } from '@/lib/admissions/visitor'
import { getSessionIdentity } from '@/lib/auth/session'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { clientIpFromHeaders } from '@/lib/rate-limit'
import { createRateLimiter } from '@/lib/rate-limit-shared'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Public admissions assistant: POST a question, receive the answer as NDJSON events (same
 * protocol as /api/assistant). Any session may ask, including anonymous visitor sessions
 * (ADR-025); without one the client must first call startVisitorSession (401 "session").
 * Availability, the budget and the per-visitor daily limit are enforced by the database in
 * admissions_begin_turn; retrieval covers published programs and public documents only.
 */

const bodySchema = z.object({
  question: z.string().trim().min(2).max(1000),
  conversationId: z.uuid().nullish(),
  locale: z.enum(['en', 'ar']),
})

// Per-instance limits (see rate-limit.ts). The database budget and daily limit apply regardless.
const perSession = createRateLimiter('admissions.session', { limit: 10, windowMs: 5 * 60_000 })
const perIp = createRateLimiter('admissions.ip', { limit: 40, windowMs: 5 * 60_000 })

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  if (!isSameOrigin(request)) return fail(403, 'forbidden')
  if (!request.headers.get('content-type')?.startsWith('application/json')) return fail(415, 'invalid')
  if (!isSupabaseConfigured()) return fail(503, 'notConfigured')

  const session = await getSessionIdentity()
  if (!session) return fail(401, 'session')
  const { tenant: slug } = await ctx.params

  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return fail(400, 'invalid')
    body = parsed.data
  } catch {
    return fail(400, 'invalid')
  }

  const ip = clientIpFromHeaders(request.headers)
  if (!(await perSession.check(`s:${session.id}`)).allowed || !(await perIp.check(`ip:${ip}`)).allowed) return fail(429, 'rateLimited')

  const page = await getPublicAdmissions(slug)
  if (!page || !page.settings.assistant_enabled) return fail(404, 'disabled')

  const locale = ARABIC.test(body.question) ? 'ar' : body.locale
  const dict = getDictionary(locale)
  const universityName = (locale === 'ar' && page.tenant.name_translations.ar) || page.tenant.name
  const branding = page.branding as { assistant_name?: string; assistant_name_ar?: string }
  const assistantName = (locale === 'ar' && branding.assistant_name_ar) || branding.assistant_name || dict.workspace.defaultAssistantName(universityName)

  const events = answerQuestion({
    supabase: await createSupabaseServerClient(),
    tenantSlug: slug,
    conversationId: body.conversationId ?? null,
    question: body.question,
    locale,
    university: { universityName, assistantName },
    texts: dict.admissions.public.answers,
    agent: 'admissions',
    programs: selectPrograms(body.question, page.programs).map(programToChunk),
  })
  return ndjsonResponse(events)
}
