'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getConversation } from '@/lib/assistant/queries'
import { toFieldErrors } from '@/lib/auth/schemas'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import { draftTicket, summarizeTicket, type TicketDraft } from './ai'
import { getSharedConversation, getTicket, listCategories } from './queries'
import { categorySchema, createTicketSchema, replySchema, updateTicketSchema } from './schemas'

/** Ticket Server Actions. The tickets_* functions and RLS authorize every one of them again. */

const uuid = z.uuid()

async function tenantIdFor(ctx: Extract<Awaited<ReturnType<typeof beginAction>>, { supabase: unknown }>, slug: string): Promise<string | null> {
  const { data } = await ctx.supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
  return data?.id ?? null
}

export async function createTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const parsed = createTicketSchema.safeParse({
    ...formValues(formData, ['subject', 'body', 'categoryId'] as const),
    // The conversation is shared only when the person ticked the box.
    conversationId: formData.get('shareConversation') === 'on' ? (formData.get('conversationId') ?? undefined) : undefined,
  })
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  if (await isRateLimited('ticket', ctx.user.id)) return errorState('rateLimited')
  const { data, error } = await ctx.supabase.rpc('tickets_create', {
    p_tenant_slug: slug.data,
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
    p_category: parsed.data.categoryId,
    p_conversation: parsed.data.conversationId,
  })
  if (error) return dbFailure('tickets_create', error)
  const id = (data as { id?: string } | null)?.id
  redirect(localizedPath(locale, `/app/${slug.data}/requests${id ? `/${id}` : ''}`))
}

/** "Draft it for me": an editable draft from the student's own assistant conversation. */
export async function draftTicketFromConversation(input: { tenant: string; conversationId: string; locale: string }): Promise<ActionState<TicketDraft>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(input.tenant)
  const conversationId = uuid.safeParse(input.conversationId)
  if (!slug.success || !conversationId.success) return errorState('invalid')
  if (await isRateLimited('ticket', ctx.user.id)) return errorState('rateLimited')
  const tenantId = await tenantIdFor(ctx, slug.data)
  if (!tenantId) return errorState('notFound')
  // RLS returns only the caller's own conversations.
  const conversation = await getConversation(tenantId, conversationId.data)
  if (!conversation) return errorState('notFound')
  const categories = await listCategories(tenantId, { activeOnly: true })
  const dict = getDictionary(input.locale === 'ar' ? 'ar' : 'en')
  const result = await draftTicket({
    supabase: ctx.supabase,
    slug: slug.data,
    turns: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    labels: { user: dict.tickets.ai.student, assistant: dict.tickets.ai.assistant },
  })
  if (!result.ok) return errorState(result.error === 'notConfigured' ? 'notConfigured' : result.error)
  return successState(result.draft)
}

export async function replyToTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = replySchema.safeParse(formValues(formData, ['ticketId', 'body'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('tickets_reply', { p_ticket: parsed.data.ticketId, p_body: parsed.data.body })
  if (error) return dbFailure('tickets_reply', error)
  refresh()
  return successState()
}

export async function closeTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const ticketId = uuid.safeParse(formData.get('ticketId'))
  if (!ticketId.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('tickets_close', { p_ticket: ticketId.data })
  if (error) return dbFailure('tickets_close', error)
  refresh()
  return successState()
}

export async function updateTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = updateTicketSchema.safeParse(formValues(formData, ['ticketId', 'status', 'priority', 'categoryId', 'departmentId', 'assigneeId'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const v = parsed.data
  const { error } = await ctx.supabase.rpc('tickets_update', {
    p_ticket: v.ticketId,
    p_status: v.status,
    p_priority: v.priority,
    p_category: v.categoryId,
    p_department: v.departmentId,
    p_assignee: v.assigneeId,
  })
  if (error) return dbFailure('tickets_update', error)
  refresh()
  return successState()
}

export async function addTicketNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const parsed = replySchema.safeParse(formValues(formData, ['ticketId', 'body'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('tickets_add_note', { p_ticket: parsed.data.ticketId, p_body: parsed.data.body })
  if (error) return dbFailure('tickets_add_note', error)
  refresh()
  return successState()
}

/** Staff: an AI summary of the thread and the shared conversation, saved as an internal note. */
export async function summarizeTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const slug = slugField.safeParse(formData.get('tenant'))
  const ticketId = uuid.safeParse(formData.get('ticketId'))
  if (!slug.success || !ticketId.success) return errorState('invalid')
  if (await isRateLimited('ticket', ctx.user.id)) return errorState('rateLimited')
  const tenantId = await tenantIdFor(ctx, slug.data)
  if (!tenantId) return errorState('notFound')
  const found = await getTicket(tenantId, ticketId.data)
  if (!found) return errorState('notFound')
  const shared = found.ticket.conversation_id ? await getSharedConversation(found.ticket.id).catch(() => []) : []
  const t = getDictionary(locale).tickets
  const result = await summarizeTicket({
    supabase: ctx.supabase,
    slug: slug.data,
    subject: found.ticket.subject,
    thread: found.messages.map((m) => ({ fromStaff: m.from_staff, body: m.body })),
    shared: shared.map((m) => ({ role: m.role, content: m.content })),
    language: locale === 'ar' ? 'Arabic' : 'English',
    labels: { requester: t.ai.requester, staff: t.ai.staff, user: t.ai.student, assistant: t.ai.assistant, openQuestions: t.ai.openQuestions, nextStep: t.ai.nextStep },
  })
  if (!result.ok) return errorState(result.error === 'notConfigured' ? 'notConfigured' : result.error)
  const { error } = await ctx.supabase.rpc('tickets_add_ai_summary', { p_ticket: ticketId.data, p_summary: result.text, p_model: result.model })
  if (error) return dbFailure('tickets_add_ai_summary', error)
  refresh()
  return successState()
}

export async function saveCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const categoryId = formData.get('categoryId') ? uuid.safeParse(formData.get('categoryId')) : null
  if (!slug.success || (categoryId && !categoryId.success)) return errorState('invalid')
  const parsed = categorySchema.safeParse(formValues(formData, ['name', 'nameAr', 'departmentId', 'defaultPriority', 'sortOrder'] as const))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const row = {
    name: parsed.data.name,
    name_ar: parsed.data.nameAr,
    department_id: parsed.data.departmentId,
    default_priority: parsed.data.defaultPriority,
    sort_order: parsed.data.sortOrder,
  }
  if (categoryId) {
    const { data, error } = await ctx.supabase.from('ticket_categories').update(row).eq('id', categoryId.data!).select('id')
    if (error) return dbFailure('ticket_category_update', error)
    if (!data?.length) return errorState('forbidden')
  } else {
    const tenantId = await tenantIdFor(ctx, slug.data)
    if (!tenantId) return errorState('forbidden')
    const { error } = await ctx.supabase.from('ticket_categories').insert({ ...row, tenant_id: tenantId })
    if (error) return dbFailure('ticket_category_insert', error)
  }
  refresh()
  return successState()
}

export async function setCategoryActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const categoryId = uuid.safeParse(formData.get('categoryId'))
  if (!categoryId.success) return errorState('invalid')
  const { data, error } = await ctx.supabase.from('ticket_categories').update({ active: formData.get('active') === 'true' }).eq('id', categoryId.data).select('id')
  if (error) return dbFailure('ticket_category_active', error)
  if (!data?.length) return errorState('forbidden')
  refresh()
  return successState()
}

export async function markNotificationsRead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!slug.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('notifications_mark_read', { p_tenant_slug: slug.data, p_ids: null })
  if (error) return dbFailure('notifications_mark_read', error)
  refresh()
  return successState()
}
