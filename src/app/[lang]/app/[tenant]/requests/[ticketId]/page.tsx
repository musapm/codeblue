import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { MessageForm } from '@/components/tickets/ticket-forms'
import { TicketThread } from '@/components/tickets/thread'
import { ActionButton } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { closeTicket } from '@/lib/tickets/actions'
import { getTicket, listCategories } from '@/lib/tickets/queries'
import { categoryName, STATUS_VARIANT } from '@/lib/tickets/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Requester view of one of their own requests. */
export default async function RequestPage({ params }: PageProps<'/[lang]/app/[tenant]/requests/[ticketId]'>) {
  const { tenant: slug, ticketId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.read_own', feature: 'ticketing' })
  if (!ctx.tenantId) notFound()
  const [found, categories] = await Promise.all([getTicket(ctx.tenantId, ticketId), listCategories(ctx.tenantId)])
  if (!found || found.ticket.requester_id !== ctx.user.id) notFound()
  const { ticket, messages } = found
  const t = dict.tickets
  const { canWrite } = writeMode(ctx, dict)
  const closed = ticket.status === 'closed'
  const formMsgs = formMessages(dict)

  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, `/app/${slug}/requests`)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.requests.back}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" dir="auto">
          {ticket.subject}
        </h1>
        <span className="font-mono text-sm text-muted-foreground" dir="ltr">
          {ticket.reference}
        </span>
        <Badge variant={STATUS_VARIANT[ticket.status] ?? 'neutral'}>{t.statuses[ticket.status] ?? ticket.status}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {categoryName(locale, categories.find((c) => c.id === ticket.category_id), t.noCategory)} · {formatDate(locale, ticket.created_at, true)}
      </p>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <TicketThread messages={messages} viewer={{ userId: ctx.user.id, asStaff: false }} labels={{ staff: t.staffLabel, you: t.you, formatTime: (iso) => formatDate(locale, iso, true) }} />
          {closed ? (
            <Alert variant="info">{t.requests.closedNotice}</Alert>
          ) : canWrite ? (
            <div className="space-y-3 border-t border-border pt-4">
              <MessageForm kind="reply" hidden={{ ticketId: ticket.id }} messages={formMsgs} labels={{ label: t.requests.reply, placeholder: t.requests.replyPlaceholder, submit: t.requests.send, sending: t.requests.sending }} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!closed && canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.requests.close}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionButton action={closeTicket} hidden={{ ticketId: ticket.id }} messages={formMsgs} confirmMessage={t.requests.closeConfirm} label={t.requests.close} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
