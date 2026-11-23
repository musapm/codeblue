import { z } from 'zod'
import { answerQuestion } from '@/lib/ai/assistant'
import { ARABIC, isSameOrigin, jsonError as fail, ndjsonResponse } from '@/lib/ai/http'
import { getCurrentUser } from '@/lib/auth/session'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { logger } from '@/lib/logger'
import { clientIpFromHeaders, createMemoryRateLimiter } from '@/lib/rate-limit'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isOperating, tenantAccessPayloadSchema, toTenantSummary } from '@/lib/tenancy/mappers'

/**
 * Student assistant endpoint: POST a question, receive the answer as a stream of NDJSON events
 * (`meta`, `status`, `delta`, then `done` or `error`; see AssistantEvent).
 *
 * A Route Handler (not a Server Action) because the answer streams. It is therefore guarded
 * like one: same-origin only, JSON only, signed-in users only, rate limited. Authorization
 * (membership, `assistant.use`, the `student_assistant` feature, the university's on/off
 * switch and monthly budget) is decided by the database in assistant_begin_turn, and
 * retrieval runs with the student's own session, so they only ever see passages they may read.
 */

const log = logger.child({ module: 'assistant.route' })

const bodySchema = z.object({
  question: z.string().trim().min(2).max(2000),
  conversationId: z.uuid().nullish(),
  locale: z.enum(['en', 'ar']),
})

// Per-instance limits (see rate-limit.ts). The database budget caps spending regardless.
const perUser = createMemoryRateLimiter({ limit: 20, windowMs: 5 * 60_000 })
const perIp = createMemoryRateLimiter({ limit: 60, windowMs: 5 * 60_000 })


export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  if (!isSameOrigin(request)) return fail(403, 'forbidden')
  if (!request.headers.get('content-type')?.startsWith('application/json')) return fail(415, 'invalid')
  if (!isSupabaseConfigured()) return fail(503, 'preview')

  const user = await getCurrentUser()
  if (!user || user.isPreview) return fail(401, 'forbidden')
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
  if (!perUser.check(`u:${user.id}`).allowed || !perIp.check(`ip:${ip}`).allowed) return fail(429, 'rateLimited')

  const supabase = await createSupabaseServerClient()
  const access = await supabase.rpc('my_tenant_access', { p_slug: slug })
  if (access.error) {
    log.error('assistant.access_failed', { code: access.error.code })
    return fail(500, 'generic')
  }
  if (access.data === null) return fail(404, 'forbidden') // not a member: same answer as no such university
  const parsed = tenantAccessPayloadSchema.safeParse(access.data)
  if (!parsed.success) return fail(500, 'generic')
  if (!isOperating(parsed.data.tenant.status)) return fail(403, 'forbidden')

  // Fixed answers follow the language the student wrote in, not only the interface language.
  const locale = ARABIC.test(body.question) ? 'ar' : body.locale
  const dict = getDictionary(locale)
  const tenant = toTenantSummary(parsed.data.tenant, parsed.data.branding, locale, {
    assistantName: dict.workspace.defaultAssistantName,
    welcome: dict.workspace.defaultWelcome,
  })

  const events = answerQuestion({
    supabase,
    tenantSlug: slug,
    conversationId: body.conversationId ?? null,
    question: body.question,
    locale,
    university: { universityName: tenant.name, assistantName: tenant.assistantName },
    texts: dict.management.assistant.answers,
  })

  return ndjsonResponse(events)
}
