import { z } from 'zod'
import { answerQuestion } from '@/lib/ai/assistant'
import { ARABIC, isSameOrigin, jsonError as fail, ndjsonResponse } from '@/lib/ai/http'
import { getCurrentUser } from '@/lib/auth/session'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { logger } from '@/lib/logger'
import { clientIpFromHeaders } from '@/lib/rate-limit'
import { createRateLimiter } from '@/lib/rate-limit-shared'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isOperating, tenantAccessPayloadSchema, toTenantSummary } from '@/lib/tenancy/mappers'

/**
 * Staff assistant endpoint (Phase 10): the same NDJSON answer stream as the student assistant
 * (/api/assistant/[tenant]), with conversations of agent 'staff'. Guarded the same way (same
 * origin, JSON, signed in, rate limited); authorization (`assistant.staff.use`, the
 * `staff_assistant` feature, the switch, the monthly budget and the daily limit per person) is
 * decided by the database in staff_begin_turn. Retrieval runs with the staff member's own
 * session, optionally limited to one department's documents: never more than they may read.
 */

const log = logger.child({ module: 'staff.route' })

const bodySchema = z.object({
  question: z.string().trim().min(2).max(2000),
  conversationId: z.uuid().nullish(),
  departmentId: z.uuid().nullish(),
  locale: z.enum(['en', 'ar']),
})

// Per-instance limits (see rate-limit.ts). The database's budget and daily limit apply regardless.
const perUser = createRateLimiter('staff-assistant.user', { limit: 20, windowMs: 5 * 60_000 })
const perIp = createRateLimiter('staff-assistant.ip', { limit: 60, windowMs: 5 * 60_000 })

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
  if (!(await perUser.check(`u:${user.id}`)).allowed || !(await perIp.check(`ip:${ip}`)).allowed) return fail(429, 'rateLimited')

  const supabase = await createSupabaseServerClient()
  const access = await supabase.rpc('my_tenant_access', { p_slug: slug })
  if (access.error) {
    log.error('staff.access_failed', { code: access.error.code })
    return fail(500, 'generic')
  }
  if (access.data === null) return fail(404, 'forbidden') // not a member: same answer as no such university
  const parsed = tenantAccessPayloadSchema.safeParse(access.data)
  if (!parsed.success) return fail(500, 'generic')
  if (!isOperating(parsed.data.tenant.status)) return fail(403, 'forbidden')

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
    university: { universityName: tenant.name, assistantName: dict.staff.chat.assistantName },
    texts: dict.staff.answers,
    agent: 'staff',
    departmentId: body.departmentId ?? null,
  })

  return ndjsonResponse(events)
}
