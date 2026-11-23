import Link from 'next/link'
import { Bell } from 'lucide-react'

/**
 * Header link to the notifications page with the unread count. Server component: the count
 * is read when the layout renders and refreshed by Server Actions that call refresh().
 * `count` is null when it could not be read (the bell still works, without a number).
 */
export function NotificationBell({ href, count, label }: { href: string; count: number | null; label: string }) {
  const shown = count && count > 0 ? (count > 99 ? '99+' : String(count)) : null
  return (
    <Link href={href} aria-label={label} title={label} className="relative inline-flex size-10 items-center justify-center rounded-md hover:bg-muted">
      <Bell aria-hidden className="size-5" />
      {shown ? (
        <span aria-hidden className="absolute end-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.65rem] leading-4 font-semibold text-white">
          {shown}
        </span>
      ) : null}
    </Link>
  )
}
