import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** The public thread of a ticket (requester ↔ staff). Server component; plain data in. */
export function TicketThread({
  messages,
  viewer,
  labels,
}: {
  messages: { id: string; author_name: string; from_staff: boolean; body: string; created_at: string; author_id: string | null }[]
  /** Who is reading: requesters see their messages on the end side, staff see staff messages there. */
  viewer: { userId: string; asStaff: boolean }
  labels: { staff: string; you: string; formatTime: (iso: string) => string }
}) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        const own = viewer.asStaff ? m.from_staff : !m.from_staff
        return (
          <li key={m.id} className={cn('flex', own ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-2xl border px-4 py-3 text-sm', own ? 'rounded-ee-sm border-primary/20 bg-primary-subtle' : 'rounded-es-sm border-border bg-card')}>
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground" dir="auto">
                  {m.author_id === viewer.userId ? labels.you : m.author_name}
                </span>
                {m.from_staff ? <Badge variant="primary">{labels.staff}</Badge> : null}
                <span>{labels.formatTime(m.created_at)}</span>
              </p>
              <p className="whitespace-pre-line" dir="auto">
                {m.body}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
