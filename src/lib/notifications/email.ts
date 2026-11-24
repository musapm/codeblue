import 'server-only'

/**
 * Email delivery for notifications (Phase 14). Notifications chosen for email are queued in
 * outbound_messages with a reference only. A sender delivers them: it renders each message from
 * the referenced ticket or request at send time (so no text sits in the queue) and marks it sent
 * or failed. No email provider is connected yet (getEmailSender() returns null); choosing one
 * is a decision for the product owner, and it needs a key and a scheduled worker with the
 * service role.
 */

export type EmailMessage = { to: string; subject: string; text: string }
export interface EmailSender {
  readonly id: string
  send(message: EmailMessage): Promise<void>
}

export function getEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  void env.EMAIL_PROVIDER // no adapter registered yet
  return null
}

export type QueuedMessage = { id: number; attempts: number }
export interface Outbox {
  /** The oldest queued messages. */
  take(limit: number): Promise<QueuedMessage[]>
  /** Recipient and text for a message, read when sending; null when it can no longer be sent (e.g. no access anymore). */
  render(id: number): Promise<EmailMessage | null>
  /** Records the outcome; 'queued' means "try again later" (the attempt is counted). */
  mark(id: number, result: { status: 'sent' | 'failed' | 'skipped' | 'queued'; error?: string }): Promise<void>
}

const MAX_ATTEMPTS = 5

/** One delivery round: send, skip what can no longer be sent, keep failures queued for up to 5 attempts. */
export async function deliverQueued(outbox: Outbox, sender: EmailSender, limit = 50): Promise<{ sent: number; failed: number; skipped: number; retrying: number }> {
  const counts = { sent: 0, failed: 0, skipped: 0, retrying: 0 }
  for (const m of await outbox.take(limit)) {
    const message = await outbox.render(m.id)
    if (!message) {
      await outbox.mark(m.id, { status: 'skipped' })
      counts.skipped++
      continue
    }
    try {
      await sender.send(message)
      await outbox.mark(m.id, { status: 'sent' })
      counts.sent++
    } catch (error) {
      const final = m.attempts + 1 >= MAX_ATTEMPTS
      await outbox.mark(m.id, { status: final ? 'failed' : 'queued', error: String(error instanceof Error ? error.message : error).slice(0, 300) })
      if (final) counts.failed++
      else counts.retrying++
    }
  }
  return counts
}
