import { after } from 'next/server'
import { z } from 'zod'
import { answerQuestion, type AssistantEvent } from '@/lib/ai/assistant'
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

const NO_STORE = { 'Cache-Control': 'no-store' }

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

/** Browsers always send Origin on cross-origin POSTs; require it to match this host. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

const ARABIC = /\p{Script=Arabic}/u

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

  return new Response(toNdjson(events), {
    headers: { ...NO_STORE, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  })
}

/**
 * Stream the events as NDJSON. The generator always runs to the end, even if the student
 * closes the page, so the answer and its usage are still stored (and billed usage recorded);
 * `after()` keeps the request alive until then.
 */
function toNdjson(events: AsyncGenerator<AssistantEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let markDone!: () => void
  after(new Promise<void>((resolve) => (markDone = resolve)))

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (event: AssistantEvent) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          open = false // the client went away; keep consuming so the turn is stored
        }
      }
      try {
        for await (const event of events) send(event)
      } catch (error) {
        log.error('assistant.stream_failed', { error })
        send({ type: 'error', error: 'generic' })
      } finally {
        markDone()
        if (open) {
          try {
            controller.close()
          } catch {
            // already closed by the client
          }
        }
      }
    },
  })
}
