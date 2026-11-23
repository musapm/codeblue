import { z } from 'zod'

/** Ticket constants and form validation (pure; mirrors the database constraints). */

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const OPEN_STATUSES = ['open', 'in_progress', 'waiting'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid({ error: 'invalidValue' }).nullable())

export const createTicketSchema = z.object({
  subject: z.string({ error: 'subjectRequired' }).trim().min(3, { error: 'subjectRequired' }).max(200, { error: 'nameTooLong' }),
  body: z.string({ error: 'messageRequired' }).trim().min(1, { error: 'messageRequired' }).max(8000, { error: 'messageTooLong' }),
  categoryId: optionalUuid,
  conversationId: optionalUuid,
})

export const replySchema = z.object({
  ticketId: z.uuid(),
  body: z.string({ error: 'messageRequired' }).trim().min(1, { error: 'messageRequired' }).max(8000, { error: 'messageTooLong' }),
})

export const updateTicketSchema = z.object({
  ticketId: z.uuid(),
  status: z.enum(TICKET_STATUSES, { error: 'invalidValue' }),
  priority: z.enum(TICKET_PRIORITIES, { error: 'invalidValue' }),
  categoryId: optionalUuid,
  departmentId: optionalUuid,
  assigneeId: optionalUuid,
})

export const categorySchema = z.object({
  name: z.string({ error: 'nameRequired' }).trim().min(2, { error: 'nameRequired' }).max(80, { error: 'nameTooLong' }),
  nameAr: z
    .string()
    .trim()
    .max(80, { error: 'nameTooLong' })
    .optional()
    .transform((v) => (v ? v : null)),
  departmentId: optionalUuid,
  defaultPriority: z.enum(TICKET_PRIORITIES, { error: 'invalidValue' }),
  sortOrder: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0))
    .pipe(z.number({ error: 'numberInvalid' }).int({ error: 'numberInvalid' }).min(-1000, { error: 'numberInvalid' }).max(1000, { error: 'numberInvalid' })),
})

export type Queue = 'mine' | 'department' | 'unassigned' | 'all'

/** Which queues a staff member has, from their permissions. */
export function availableQueues(perms: { readDepartment: boolean; readAll: boolean; update: boolean }): Queue[] {
  if (!perms.update) return []
  const queues: Queue[] = ['mine']
  if (perms.readDepartment) queues.push('department')
  if (perms.readAll) queues.push('unassigned', 'all')
  return queues
}

/** Order for staff queues: urgent first, then the longest-waiting activity. */
export function priorityRank(p: string): number {
  return { urgent: 0, high: 1, normal: 2, low: 3 }[p] ?? 4
}
