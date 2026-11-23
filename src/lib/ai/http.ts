import 'server-only'
import { after } from 'next/server'
import { logger } from '@/lib/logger'
import type { AssistantEvent } from './assistant'

/** Shared transport for the streaming assistant endpoints (student and admissions). */

const log = logger.child({ module: 'assistant.http' })

export const NO_STORE = { 'Cache-Control': 'no-store' }

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

/** Browsers always send Origin on cross-origin POSTs; require it to match this host. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export const ARABIC = /\p{Script=Arabic}/u

/**
 * Stream events as NDJSON. The generator always runs to the end, even if the client goes
 * away, so the turn and its usage are still stored; `after()` keeps the request alive.
 */
export function ndjsonResponse(events: AsyncGenerator<AssistantEvent>): Response {
  const encoder = new TextEncoder()
  let markDone!: () => void
  after(new Promise<void>((resolve) => (markDone = resolve)))

  const stream = new ReadableStream<Uint8Array>({
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
  return new Response(stream, {
    headers: { ...NO_STORE, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  })
}
