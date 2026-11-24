import { CircleDot, Lock, MessageSquare, UserCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import type { Locale } from '@/lib/i18n/config'
import { formatDate } from '@/lib/management/view'
import type { RequestEvent } from '@/lib/workflows/queries'

/** A request's history. The rows come through RLS: requesters never receive internal events. */
export function RequestTimeline({ events, locale, dict }: { events: RequestEvent[]; locale: Locale; dict: Dictionary }) {
  const t = dict.workflows.request.events
  const status = (s: string | null) => (s ? (dict.workflows.statuses[s] ?? s) : '')
  return (
    <ol className="space-y-4">
      {events.map((e) => {
        const Icon = e.kind === 'note' ? Lock : e.kind === 'comment' ? MessageSquare : e.kind === 'assigned' ? UserCheck : CircleDot
        const title =
          e.kind === 'submitted'
            ? t.submitted
            : e.kind === 'status'
              ? t.status(status(e.to_status))
              : e.kind === 'cancelled'
                ? t.cancelled
                : e.kind === 'assigned'
                  ? t.assigned(e.body)
                  : e.kind === 'note'
                    ? t.note
                    : t.comment
        return (
          <li key={e.id} className="flex gap-3">
            <Icon aria-hidden className={e.internal ? 'mt-0.5 size-4 shrink-0 text-warning' : 'mt-0.5 size-4 shrink-0 text-muted-foreground'} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{title}</span>
                {e.internal ? <Badge variant="warning">{dict.workflows.process.staffOnly}</Badge> : null}
                <span className="text-xs text-muted-foreground">
                  {e.actor_name ? `${e.actor_name} · ` : ''}
                  {formatDate(locale, e.created_at, true)}
                </span>
              </p>
              {e.body && e.kind !== 'assigned' ? (
                <p className={e.internal ? 'rounded-md bg-warning-subtle px-3 py-2 text-sm whitespace-pre-line' : 'rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line'} dir="auto">
                  {e.body}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
