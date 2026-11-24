import Link from 'next/link'
import { Bell, CheckCheck } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { ActionButton } from '@/components/management/action-form'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { markNotificationsRead } from '@/lib/tickets/actions'
import { listNotifications } from '@/lib/tickets/queries'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { cn } from '@/lib/utils'

/** In-app notifications for the signed-in person: tickets and service requests (email delivery comes with Phase 14). */
export default async function NotificationsPage({ params }: PageProps<'/[lang]/app/[tenant]/notifications'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { feature: ['ticketing', 'workflow_agent'] })
  const t = dict.tickets.notifications
  const { canWrite } = writeMode(ctx, dict)
  const items = ctx.tenantId ? await listNotifications(slug) : []
  const unread = items.some((n) => !n.read)
  const text = (kind: string, ref: string) => {
    const fn = t.kinds[kind as keyof typeof t.kinds]
    return fn ? fn(ref) : ref
  }

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          canWrite && unread ? (
            <ActionButton action={markNotificationsRead} hidden={{ tenant: slug }} messages={formMessages(dict)} label={t.markAll} icon={<CheckCheck aria-hidden />} />
          ) : undefined
        }
      />
      <Card>
        <CardContent className="pt-6">
          {items.length === 0 ? (
            <EmptyState icon={<Bell />} title={t.empty} />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {items.map((n) => (
                <li key={n.id} className={cn('relative px-4 py-3', !n.read && 'bg-primary-subtle/40')}>
                  <Link
                    href={localizedPath(
                      locale,
                      n.request_id
                        ? `/app/${slug}/${n.mine ? 'services' : 'workflows/requests'}/${n.request_id}`
                        : `/app/${slug}/${n.mine ? 'requests' : 'tickets'}/${n.ticket_id}`,
                    )}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {!n.read ? <span aria-hidden className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-primary" /> : null}
                    <span className={cn('text-sm', !n.read && 'font-semibold')}>{text(n.kind, n.reference)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" dir="auto">
                      {(locale === 'ar' && n.subject_ar) || n.subject}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(locale, n.created_at, true)}</span>
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
