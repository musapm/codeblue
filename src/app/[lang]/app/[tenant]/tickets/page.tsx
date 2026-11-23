import Link from 'next/link'
import { Inbox, Search, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, writeMode } from '@/lib/management/view'
import { listCategories, listQueue, listTicketAssignees } from '@/lib/tickets/queries'
import { availableQueues, type Queue } from '@/lib/tickets/schemas'
import { categoryName, PRIORITY_VARIANT, STATUS_VARIANT } from '@/lib/tickets/view'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { cn } from '@/lib/utils'

/** Staff queues: assigned to me, my departments, unassigned, all (by permission). */
export default async function TicketsPage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/tickets'>) {
  const { tenant: slug } = await params
  const sp = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'tickets.read_department', feature: 'ticketing' })
  const t = dict.tickets
  const { notice } = writeMode(ctx, dict)
  const queues = availableQueues({
    readDepartment: hasWorkspacePermission(ctx, 'tickets.read_department'),
    readAll: hasWorkspacePermission(ctx, 'tickets.read_all'),
    update: hasWorkspacePermission(ctx, 'tickets.update'),
  })
  const requested = typeof sp.queue === 'string' ? (sp.queue as Queue) : undefined
  const queue: Queue = requested && queues.includes(requested) ? requested : (queues[0] ?? 'mine')
  const state = sp.state === 'done' ? 'done' : 'open'
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : undefined
  const base = localizedPath(locale, `/app/${slug}/tickets`)
  const href = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ queue, state, q, ...over }).filter((e): e is [string, string] => Boolean(e[1])))
    return `${base}?${params.toString()}`
  }

  const [tickets, categories] =
    ctx.tenantId && queues.length ? await Promise.all([listQueue(ctx.tenantId, ctx.user.id, ctx.departmentIds, { queue, state, q }), listCategories(ctx.tenantId)]) : [[], []]
  // Names of the people who can hold these tickets: one lookup per department in the list.
  const departments = [...new Set(tickets.map((x) => x.department_id))]
  const people = (await Promise.all(departments.map((d) => listTicketAssignees(slug, d)))).flat()
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const nameById = new Map(people.map((p) => [p.user_id, p.name]))

  return (
    <>
      <PageHeader
        title={t.queue.title}
        description={t.queue.subtitle}
        actions={
          hasWorkspacePermission(ctx, 'departments.manage') ? (
            <Link href={`${base}/categories`} className={buttonClasses({ variant: 'secondary' })}>
              <Settings2 aria-hidden />
              {t.queue.categories}
            </Link>
          ) : undefined
        }
      />
      {notice ? <Alert variant="info" className="mb-6">{notice}</Alert> : null}
      {queues.length === 0 ? (
        <Alert variant="info">{t.queue.noQueues}</Alert>
      ) : (
        <Card>
          <CardHeader className="gap-4">
            <nav className="flex flex-wrap gap-2" aria-label={t.queue.title}>
              {queues.map((key) => (
                <Link key={key} href={href({ queue: key })} aria-current={key === queue ? 'page' : undefined} className={buttonClasses({ variant: key === queue ? 'primary' : 'secondary', size: 'sm' })}>
                  {t.queue.tabs[key]}
                </Link>
              ))}
              <span className="mx-1 hidden w-px bg-border sm:block" />
              {(['open', 'done'] as const).map((s) => (
                <Link key={s} href={href({ state: s })} aria-current={s === state ? 'page' : undefined} className={cn(buttonClasses({ variant: 'ghost', size: 'sm' }), s === state && 'bg-muted')}>
                  {t.queue.state[s]}
                </Link>
              ))}
            </nav>
            <form method="get" className="flex flex-wrap items-end gap-2" role="search">
              <input type="hidden" name="queue" value={queue} />
              <input type="hidden" name="state" value={state} />
              <label className="min-w-48 flex-1 text-xs font-medium text-muted-foreground">
                {t.queue.search}
                <Input name="q" defaultValue={q} maxLength={80} dir="auto" className="mt-1" />
              </label>
              <Button type="submit" variant="secondary">
                <Search aria-hidden />
                {t.queue.filter}
              </Button>
            </form>
          </CardHeader>
          <CardContent>
            {tickets.length === 0 ? (
              <EmptyState icon={<Inbox />} title={t.queue.empty} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      {[t.queue.columns.reference, t.queue.columns.subject, t.queue.columns.requester, t.queue.columns.category, t.queue.columns.priority, t.queue.columns.status, t.queue.columns.assignee, t.queue.columns.activity].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tickets.map((ticket) => (
                      <tr key={ticket.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                          <Link href={`${base}/${ticket.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                            {ticket.reference}
                          </Link>
                        </td>
                        <td className="max-w-64 truncate px-3 py-2" dir="auto">
                          {ticket.subject}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground" dir="auto">
                          {ticket.requester_name}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{categoryName(locale, ticket.category_id ? categoryById.get(ticket.category_id) : undefined, t.noCategory)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={PRIORITY_VARIANT[ticket.priority] ?? 'neutral'}>{t.priorities[ticket.priority] ?? ticket.priority}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_VARIANT[ticket.status] ?? 'neutral'}>{t.staffStatuses[ticket.status] ?? ticket.status}</Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{ticket.assignee_id ? (nameById.get(ticket.assignee_id) ?? t.ticket.someone) : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDate(locale, ticket.last_activity_at, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
