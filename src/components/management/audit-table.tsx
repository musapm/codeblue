import Link from 'next/link'
import { ScrollText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/misc'

export type AuditViewRow = {
  id: number
  time: string
  actor: string
  actorKind: 'user' | 'platform_admin' | 'system'
  action: string
  details: string
  tenant?: string
}

/** Read-only audit table (server component). Pagination is keyset-based via links. */
export function AuditTable({
  rows,
  labels,
  showTenant,
  olderHref,
  newestHref,
}: {
  rows: AuditViewRow[]
  labels: { time: string; actor: string; action: string; details: string; tenant: string; empty: string; older: string; newest: string; platformStaff: string }
  showTenant?: boolean
  olderHref?: string
  newestHref?: string
}) {
  if (rows.length === 0) return <EmptyState icon={<ScrollText />} title={labels.empty} />
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {labels.time}
              </th>
              {showTenant ? (
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {labels.tenant}
                </th>
              ) : null}
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {labels.actor}
              </th>
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {labels.action}
              </th>
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {labels.details}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{r.time}</td>
                {showTenant ? (
                  <td className="px-4 py-2.5 whitespace-nowrap" dir="ltr">
                    {r.tenant}
                  </td>
                ) : null}
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {r.actor}
                    {r.actorKind === 'platform_admin' ? <Badge variant="warning">{labels.platformStaff}</Badge> : null}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-medium">{r.action}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {olderHref || newestHref ? (
        <div className="flex gap-2">
          {newestHref ? (
            <Link href={newestHref} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              {labels.newest}
            </Link>
          ) : null}
          {olderHref ? (
            <Link href={olderHref} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              {labels.older}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
