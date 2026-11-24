import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sanitizeLeadSearch } from '@/lib/admissions/schemas'
import { OPEN_STATUSES, priorityRank, type Queue } from './schemas'

/** Read side of tickets. RLS decides visibility (own / department / all / assigned; notes staff-only). */

const log = logger.child({ module: 'tickets' })

function fail(op: string, error: { code?: string }): never {
  log.error('tickets.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type Ticket = Database['public']['Tables']['tickets']['Row']
export type TicketMessage = Database['public']['Tables']['ticket_messages']['Row']
export type TicketNote = Database['public']['Tables']['ticket_internal_notes']['Row']
export type TicketEvent = Database['public']['Tables']['ticket_events']['Row']
export type TicketCategory = Database['public']['Tables']['ticket_categories']['Row']

export async function listCategories(tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<TicketCategory[]> {
  const supabase = await createSupabaseServerClient()
  let q = supabase.from('ticket_categories').select('*').eq('tenant_id', tenantId)
  if (opts.activeOnly) q = q.eq('active', true)
  const { data, error } = await q.order('sort_order').order('name').limit(200)
  if (error) fail('ticket_categories', error)
  return data ?? []
}

/** The caller's own requests. */
export async function listMyTickets(tenantId: string, userId: string): Promise<Ticket[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('requester_id', userId)
    .order('last_activity_at', { ascending: false })
    .limit(200)
  if (error) fail('my_tickets', error)
  return data ?? []
}

export type QueueFilters = { queue: Queue; state: 'open' | 'done'; q?: string }

/** A staff queue. RLS has already limited rows to what the caller may see. */
export async function listQueue(tenantId: string, userId: string, departmentIds: string[], f: QueueFilters): Promise<Ticket[]> {
  const supabase = await createSupabaseServerClient()
  let q = supabase.from('tickets').select('*').eq('tenant_id', tenantId).neq('requester_id', userId)
  q = f.state === 'open' ? q.in('status', [...OPEN_STATUSES]) : q.in('status', ['resolved', 'closed'])
  if (f.queue === 'mine') q = q.eq('assignee_id', userId)
  if (f.queue === 'department') q = departmentIds.length ? q.in('department_id', departmentIds) : q.eq('id', '00000000-0000-0000-0000-000000000000')
  if (f.queue === 'unassigned') q = q.is('assignee_id', null)
  const term = sanitizeLeadSearch(f.q)
  if (term) q = q.or(`subject.ilike.%${term}%,reference.ilike.%${term}%,requester_name.ilike.%${term}%`)
  const { data, error } = await q.order('last_activity_at', { ascending: true }).limit(200)
  if (error) fail('ticket_queue', error)
  const rows = data ?? []
  // Open queues: most urgent first, then whoever has waited longest. Done: most recent first.
  return f.state === 'open'
    ? rows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.last_activity_at.localeCompare(b.last_activity_at))
    : rows.sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
}

export async function getTicket(
  tenantId: string,
  id: string,
): Promise<{ ticket: Ticket; messages: TicketMessage[]; notes: TicketNote[]; events: TicketEvent[] } | null> {
  if (!z.uuid().safeParse(id).success) return null
  const supabase = await createSupabaseServerClient()
  const ticket = await supabase.from('tickets').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (ticket.error) fail('ticket', ticket.error)
  if (!ticket.data) return null
  const [messages, notes, events] = await Promise.all([
    supabase.from('ticket_messages').select('*').eq('ticket_id', id).order('created_at').limit(500),
    supabase.from('ticket_internal_notes').select('*').eq('ticket_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('ticket_events').select('*').eq('ticket_id', id).order('created_at', { ascending: false }).limit(200),
  ])
  if (messages.error) fail('ticket_messages', messages.error)
  if (notes.error) fail('ticket_notes', notes.error)
  if (events.error) fail('ticket_events', events.error)
  return { ticket: ticket.data, messages: messages.data ?? [], notes: notes.data ?? [], events: events.data ?? [] }
}

export type SharedMessage = { role: 'user' | 'assistant'; content: string; status: string; created_at: string }

export async function getSharedConversation(ticketId: string): Promise<SharedMessage[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('tickets_shared_conversation', { p_ticket: ticketId })
  if (error) fail('tickets_shared_conversation', error)
  return z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string(), status: z.string().catch(''), created_at: z.string() }))
    .catch([])
    .parse(data)
}

export async function listTicketAssignees(slug: string, departmentId: string | null): Promise<{ user_id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('tickets_assignees', { p_tenant_slug: slug, p_department: departmentId })
  if (error) fail('tickets_assignees', error)
  return z.array(z.object({ user_id: z.string(), name: z.string() })).catch([]).parse(data)
}

export type NotificationItem = {
  id: number
  kind: string
  created_at: string
  read: boolean
  /** A ticket (Phase 7) or a service request (Phase 11). */
  ticket_id?: string
  request_id?: string
  reference: string
  subject: string
  subject_ar?: string | null
  mine: boolean
}

const NotificationSchema = z.object({
  id: z.number(),
  kind: z.string(),
  created_at: z.string(),
  read: z.boolean(),
  ticket_id: z.string().optional(),
  request_id: z.string().optional(),
  reference: z.string(),
  subject: z.string(),
  subject_ar: z.string().nullish(),
  mine: z.boolean(),
})

export async function listNotifications(slug: string): Promise<NotificationItem[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('my_notifications', { p_tenant_slug: slug, p_limit: 50 })
  if (error) fail('my_notifications', error)
  // Item by item: one unexpected entry must not hide the others.
  return (Array.isArray(data) ? data : []).flatMap((item) => {
    const parsed = NotificationSchema.safeParse(item)
    return parsed.success && (parsed.data.ticket_id || parsed.data.request_id) ? [parsed.data] : []
  })
}

/** Unread notifications for the header bell. Never throws: the bell must not break a page. */
export async function unreadNotificationCount(tenantId: string): Promise<number | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('read_at', null)
    if (error) {
      log.warn('tickets.unread_count_failed', { code: error.code })
      return null
    }
    return count ?? 0
  } catch (error) {
    log.warn('tickets.unread_count_failed', { error })
    return null
  }
}
