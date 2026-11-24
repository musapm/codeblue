import { z } from 'zod'

/** Notification kinds and preferences (Phase 14). In-app is on by default, email off. */
export const NOTIFICATION_KINDS = ['ticket_new', 'ticket_assigned', 'ticket_reply', 'ticket_status', 'request_new', 'request_assigned', 'request_comment', 'request_status'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export type Preference = { kind: NotificationKind; inApp: boolean; email: boolean }

export const preferenceSchema = z.object({
  tenant: z.string().min(1).max(64),
  kind: z.enum(NOTIFICATION_KINDS),
  inApp: z.boolean(),
  email: z.boolean(),
})
