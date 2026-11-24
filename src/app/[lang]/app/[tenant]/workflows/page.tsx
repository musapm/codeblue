import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Inbox, Search } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission } from '@/lib/tenancy/context'
import { cn } from '@/lib/utils'
import { definitionTitles, listRequestQueue, type RequestQueue } from '@/lib/workflows/queries'
import { REQUEST_STATUSES, type RequestStatus } from '@/lib/workflows/schemas'
import { formTitle, STATUS_VARIANT } from '@/lib/workflows/view'

/** The processing queue: assigned to me, my departments, unassigned, all (by permission). Never one's own requests. */
export default async function WorkflowQueuePage({ params, searchParams }: PageProps<'/[lang]/app/[tenant]/workflows'>) {
  const { tenant: slug } = await params
  const sp = await searchParams
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const base = localizedPath(locale, `/app/${slug}/workflows`)
  if (!hasWorkspacePermission(ctx, 'tickets.update')) {
    redirect(hasWorkspacePermission(ctx, 'departments.manage') ? `${base}/forms` : `${base}/settings`)
  }
  const w = dict.workflows
  const t = w.queue
  const { notice } = writeMode(ctx, dict)

  const readDepartment = hasWorkspacePermission(ctx, 'tickets.read_department')
  const readAll = hasWorkspacePermission(ctx, 'tickets.read_all')
  const queues: RequestQueue[] = ['mine', ...(readDepartment ? (['department'] as const) : []), 'unassigned', ...(readAll ? (['all'] as const) : [])]
  const requested = typeof sp.queue === 'string' ? (sp.queue as RequestQueue) : undefined
  const queue: RequestQueue = requested && queues.includes(requested) ? requested : readDepartment ? 'department' : 'mine'
  const state = sp.state === 'done' ? 'done' : 'open'
  const status = typeof sp.status === 'string' && (REQUEST_STATUSES as readonly string[]).includes(sp.status) ? (sp.status as RequestStatus) : undefined
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : undefined
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ queue, state, q, ...over }).filter((e): e is [string, string] => Boolean(e[1])))
    return `${base}?${p.toString()}`
  }

  const rows = ctx.tenantId && !ctx.user.isPreview ? await listRequestQueue(ctx.tenantId, ctx.user.id, ctx.departmentIds, { queue, state, status, q }) : []
  const titles = ctx.tenantId && rows.length ? await definitionTitles(ctx.tenantId, rows.map((r) => r.definition_id)) : new Map()

  return (
    <>
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      <Card>
        <CardHeader className="gap-4">
          <nav className="flex flex-wrap gap-2" aria-label={t.title}>
            {queues.map((key) => (
              <Link key={key} href={href({ queue: key })} aria-current={key === queue ? 'page' : undefined} className={buttonClasses({ variant: key === queue ? 'primary' : 'secondary', size: 'sm' })}>
                {t.queues[key]}
              </Link>
            ))}
            <span className="mx-1 hidden w-px bg-border sm:block" />
            {(['open', 'done'] as const).map((s) => (
              <Link key={s} href={href({ state: s })} aria-current={s === state && !status ? 'page' : undefined} className={cn(buttonClasses({ variant: 'ghost', size: 'sm' }), s === state && !status && 'bg-muted')}>
                {t.states[s]}
              </Link>
            ))}
          </nav>
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            <input type="hidden" name="queue" value={queue} />
            <input type="hidden" name="state" value={state} />
            <label className="min-w-48 flex-1 text-xs font-medium text-muted-foreground">
              {t.search}
              <Input name="q" defaultValue={q} maxLength={80} dir="auto" className="mt-1" />
            </label>
            <Button type="submit" variant="secondary">
              <Search aria-hidden />
              {t.searchSubmit}
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState icon={<Inbox />} title={t.empty} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {[t.columns.reference, t.columns.form, t.columns.requester, t.columns.status, t.columns.assignee, t.columns.updated].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const title = titles.get(r.definition_id)
                    return (
                      <tr key={r.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                          <Link href={`${base}/requests/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                            {r.reference}
                          </Link>
                        </td>
                        <td className="max-w-64 truncate px-3 py-2" dir="auto">
                          {title ? formTitle(locale, title) : ''}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground" dir="auto">
                          {r.requester_name}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_VARIANT[r.status]}>{w.statuses[r.status]}</Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.assignee_id ? (r.assignee_id === ctx.user.id ? t.you : t.assigned) : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDate(locale, r.last_activity_at, true)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
