import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Lock, MessageSquare, Sparkles } from 'lucide-react'
import { MessageForm, SummarizeButton, TicketUpdateForm } from '@/components/tickets/ticket-forms'
import { TicketThread } from '@/components/tickets/thread'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAiConfig } from '@/lib/ai/config'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getSharedConversation, getTicket, listCategories, listTicketAssignees } from '@/lib/tickets/queries'
import { categoryName, PRIORITY_VARIANT, STATUS_VARIANT, ticketOptions } from '@/lib/tickets/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Staff view of a ticket. RLS decides what is returned; internal notes never reach requesters. */
export default async function TicketPage({ params }: PageProps<'/[lang]/app/[tenant]/tickets/[ticketId]'>) {
  const { tenant: slug, ticketId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.read_department', feature: 'ticketing' })
  if (!ctx.tenantId) notFound()
  const found = await getTicket(ctx.tenantId, ticketId)
  if (!found) notFound()
  const { ticket, messages, notes, events } = found
  const t = dict.tickets
  const back = (
    <Link href={localizedPath(locale, `/app/${slug}/tickets`)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {t.ticket.back}
    </Link>
  )
  if (ticket.requester_id === ctx.user.id) {
    return (
      <div className="space-y-4">
        {back}
        <Alert variant="info">
          {t.ticket.ownTicket}{' '}
          <Link href={localizedPath(locale, `/app/${slug}/requests/${ticket.id}`)} className="font-medium underline">
            {ticket.reference}
          </Link>
        </Alert>
      </div>
    )
  }

  const { canWrite } = writeMode(ctx, dict)
  const canWork =
    canWrite &&
    hasWorkspacePermission(ctx, 'tickets.update') &&
    (hasWorkspacePermission(ctx, 'tickets.read_all') || (ticket.department_id !== null && ctx.departmentIds.includes(ticket.department_id)) || ticket.assignee_id === ctx.user.id)
  const canWriteNotes = canWork && hasWorkspacePermission(ctx, 'tickets.notes.write')
  const canReadNotes = canWork && hasWorkspacePermission(ctx, 'tickets.notes.read')

  const [categories, departments, assignees, shared] = await Promise.all([
    listCategories(ctx.tenantId),
    listDepartments(ctx.tenantId),
    canWork ? listTicketAssignees(slug, ticket.department_id) : Promise.resolve([]),
    canWork && ticket.conversation_id ? getSharedConversation(ticket.id).catch(() => []) : Promise.resolve([]),
  ])
  const people = new Map(assignees.map((p) => [p.user_id, p.name]))
  const department = departments.find((d) => d.id === ticket.department_id)
  const messagesFmt = formMessages(dict)
  const time = (iso: string) => formatDate(locale, iso, true)
  const name = (id: string | null) => (id ? (people.get(id) ?? t.ticket.someone) : t.ticket.unassigned)
  const eventText = (e: (typeof events)[number]) => {
    switch (e.kind) {
      case 'created':
        return t.ticket.events.created(t.sources[e.to_value ?? ''] ?? '')
      case 'status':
        return t.ticket.events.status(t.staffStatuses[e.from_value ?? ''] ?? '—', t.staffStatuses[e.to_value ?? ''] ?? '—')
      case 'priority':
        return t.ticket.events.priority(t.priorities[e.from_value ?? ''] ?? '—', t.priorities[e.to_value ?? ''] ?? '—')
      case 'department':
        return t.ticket.events.department
      case 'category':
        return t.ticket.events.category
      default:
        return e.to_value ? t.ticket.events.assigned(name(e.to_value)) : t.ticket.events.unassigned
    }
  }
  const aiSummaries = notes.filter((n) => n.kind === 'ai_summary')
  const plainNotes = notes.filter((n) => n.kind !== 'ai_summary')

  return (
    <div className="space-y-6">
      {back}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" dir="auto">
            {ticket.subject}
          </h1>
          <span className="font-mono text-sm text-muted-foreground" dir="ltr">
            {ticket.reference}
          </span>
          <Badge variant={STATUS_VARIANT[ticket.status] ?? 'neutral'}>{t.staffStatuses[ticket.status] ?? ticket.status}</Badge>
          <Badge variant={PRIORITY_VARIANT[ticket.priority] ?? 'neutral'}>{t.priorities[ticket.priority] ?? ticket.priority}</Badge>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {[
            { label: t.ticket.requester, value: ticket.requester_name },
            { label: t.ticket.received, value: time(ticket.created_at) },
            { label: t.ticket.firstResponse, value: ticket.first_response_at ? time(ticket.first_response_at) : t.ticket.notYet },
            { label: t.ticket.category, value: categoryName(locale, categories.find((c) => c.id === ticket.category_id), t.noCategory) },
            { label: t.ticket.department, value: department ? (locale === 'ar' && department.nameAr) || department.name : t.noDepartment },
            { label: t.ticket.source, value: t.sources[ticket.source] ?? ticket.source },
          ].map((f) => (
            <div key={f.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{f.label}:</dt>
              <dd className="font-medium" dir="auto">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.ticket.thread}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <TicketThread messages={messages} viewer={{ userId: ctx.user.id, asStaff: true }} labels={{ staff: t.staffLabel, you: t.you, formatTime: time }} />
              {canWork && ticket.status !== 'closed' ? (
                <div className="border-t border-border pt-4">
                  <MessageForm kind="reply" hidden={{ ticketId: ticket.id }} messages={messagesFmt} labels={{ label: t.ticket.reply, placeholder: t.ticket.replyPlaceholder, submit: t.ticket.send, sending: t.requests.sending }} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          {canWork ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare aria-hidden className="size-4" />
                  {t.ticket.shared}
                </CardTitle>
                <CardDescription>{t.ticket.sharedHint}</CardDescription>
              </CardHeader>
              <CardContent>
                {shared.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.ticket.sharedEmpty}</p>
                ) : (
                  <ol className="space-y-3 text-sm">
                    {shared.map((m, i) => (
                      <li key={i} className="rounded-lg border border-border p-3">
                        <p className="mb-1 text-xs font-semibold text-muted-foreground">{m.role === 'user' ? t.ai.student : t.ai.assistant}</p>
                        <p className="whitespace-pre-line" dir="auto">
                          {m.content}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {canWork ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.ticket.manage}</CardTitle>
              </CardHeader>
              <CardContent>
                <TicketUpdateForm
                  hidden={{ ticketId: ticket.id }}
                  initial={{ status: ticket.status, priority: ticket.priority, categoryId: ticket.category_id, departmentId: ticket.department_id, assigneeId: ticket.assignee_id }}
                  options={{
                    ...ticketOptions(dict),
                    categories: categories.map((c) => ({ value: c.id, label: categoryName(locale, c, c.name) })),
                    departments: departments.filter((d) => !d.archivedAt || d.id === ticket.department_id).map((d) => ({ value: d.id, label: (locale === 'ar' && d.nameAr) || d.name })),
                    assignees: assignees.map((p) => ({ value: p.user_id, label: p.name })),
                  }}
                  messages={messagesFmt}
                  labels={{
                    status: t.ticket.status,
                    priority: t.ticket.priority,
                    category: t.ticket.category,
                    noCategory: t.noCategory,
                    department: t.ticket.department,
                    noDepartment: t.noDepartment,
                    assignee: t.ticket.assignee,
                    unassigned: t.ticket.unassigned,
                    assignHint: t.ticket.assignHint,
                    save: t.ticket.save,
                    saving: dict.management.saving,
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          {canReadNotes ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock aria-hidden className="size-4" />
                  {t.ticket.notes}
                </CardTitle>
                <CardDescription>{t.ticket.notesHint}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {canWriteNotes && getAiConfig().configured ? (
                  <SummarizeButton hidden={{ ticketId: ticket.id, tenant: slug, locale }} messages={messagesFmt} labels={{ summarize: t.ticket.summarize, summarizing: t.ticket.summarizing }} />
                ) : null}
                {aiSummaries[0] ? (
                  <div className="rounded-lg border border-primary/30 bg-primary-subtle/40 p-3 text-sm">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                      <Sparkles aria-hidden className="size-3.5" />
                      {t.ticket.aiSummary}
                    </p>
                    <p className="whitespace-pre-line" dir="auto">
                      {aiSummaries[0].body}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t.ticket.aiSummaryNote} {aiSummaries[0].author_name} · {time(aiSummaries[0].created_at)}
                    </p>
                  </div>
                ) : null}
                {canWriteNotes ? (
                  <MessageForm kind="note" hidden={{ ticketId: ticket.id }} messages={messagesFmt} labels={{ label: t.ticket.addNote, placeholder: t.ticket.notePlaceholder, submit: t.ticket.addNote, sending: dict.management.saving }} />
                ) : null}
                {plainNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.ticket.noNotes}</p>
                ) : (
                  <ul className="space-y-3">
                    {plainNotes.map((n) => (
                      <li key={n.id} className="rounded-lg border border-border p-3 text-sm">
                        <p className="whitespace-pre-line" dir="auto">
                          {n.body}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {n.author_name} · {time(n.created_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {events.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.ticket.history}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3 border-s border-border ps-4">
                  {events.map((e) => (
                    <li key={e.id} className="text-sm">
                      <p>{eventText(e)}</p>
                      <p className="text-xs text-muted-foreground">{time(e.created_at)}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
