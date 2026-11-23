import Link from 'next/link'
import { Inbox, Plus } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, writeMode } from '@/lib/management/view'
import { listMyTickets } from '@/lib/tickets/queries'
import { STATUS_VARIANT } from '@/lib/tickets/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** The signed-in person's own requests. */
export default async function MyRequestsPage({ params }: PageProps<'/[lang]/app/[tenant]/requests'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.read_own', feature: 'ticketing' })
  const t = dict.tickets
  const { canWrite, notice } = writeMode(ctx, dict)
  const tickets = ctx.tenantId ? await listMyTickets(ctx.tenantId, ctx.user.id) : []
  const base = localizedPath(locale, `/app/${slug}/requests`)

  return (
    <>
      <PageHeader
        title={t.requests.title}
        description={t.requests.subtitle}
        actions={
          canWrite && hasWorkspacePermission(ctx, 'tickets.create') ? (
            <Link href={`${base}/new`} className={buttonClasses()}>
              <Plus aria-hidden />
              {t.requests.new}
            </Link>
          ) : undefined
        }
      />
      {notice ? <Alert variant="info" className="mb-6">{notice}</Alert> : null}
      <Card>
        <CardContent className="pt-6">
          {tickets.length === 0 ? (
            <EmptyState icon={<Inbox />} title={t.requests.empty} />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link href={`${base}/${ticket.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/60">
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {ticket.reference}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                      {ticket.subject}
                    </span>
                    <Badge variant={STATUS_VARIANT[ticket.status] ?? 'neutral'}>{t.statuses[ticket.status] ?? ticket.status}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(locale, ticket.last_activity_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}
