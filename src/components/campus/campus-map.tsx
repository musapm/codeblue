import Link from 'next/link'

/**
 * The simple campus map: locations placed by their coordinates on a plain plan (no map tiles,
 * nothing loaded from third parties). Every point is a link with an accessible name; buildings
 * are labelled, other points show their name on hover and keyboard focus. The list next to it
 * carries the same information as text.
 */
export type MapPin = { id: string; x: number; y: number; label: string; href: string; building: boolean }

export const MAP_WIDTH = 800
export const MAP_HEIGHT = 480

export function CampusMap({ pins, title, hint }: { pins: MapPin[]; title: string; hint: string }) {
  return (
    <figure className="space-y-2">
      {/* The plan is geometry (east is right), so it stays left-to-right in Arabic pages; labels still shape right-to-left. */}
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="w-full rounded-lg border border-border bg-muted/30" style={{ direction: 'ltr' }} role="group" aria-label={title}>
        <defs>
          <pattern id="campus-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" className="stroke-border" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#campus-grid)" aria-hidden />
        <text x={MAP_WIDTH - 16} y={28} textAnchor="end" className="fill-muted-foreground text-[13px] font-semibold" aria-hidden>
          N ↑
        </text>
        {pins.map((p) => {
          const labelLeft = p.x > MAP_WIDTH - 180
          return (
            <Link key={p.id} href={p.href} aria-label={p.label} className="group outline-none">
              <circle cx={p.x} cy={p.y} r={18} className="fill-transparent" />
              {p.building ? (
                <rect x={p.x - 9} y={p.y - 9} width={18} height={18} rx={3} className="fill-primary stroke-background group-focus-visible:stroke-ring" strokeWidth={2} />
              ) : (
                <circle cx={p.x} cy={p.y} r={7} className="fill-primary stroke-background group-focus-visible:stroke-ring" strokeWidth={2} />
              )}
              <circle cx={p.x} cy={p.y} r={14} className="fill-none stroke-ring opacity-0 group-focus-visible:opacity-100" strokeWidth={3} />
              <text
                x={labelLeft ? p.x - 14 : p.x + 14}
                y={p.y + 4}
                textAnchor={labelLeft ? 'end' : 'start'}
                className={
                  p.building
                    ? 'fill-foreground text-[13px] font-semibold [paint-order:stroke] stroke-background [stroke-width:4px]'
                    : 'fill-foreground text-[12px] opacity-0 [paint-order:stroke] stroke-background [stroke-width:4px] group-hover:opacity-100 group-focus-visible:opacity-100'
                }
                aria-hidden
              >
                {p.label}
              </text>
            </Link>
          )
        })}
      </svg>
      <figcaption className="text-xs text-muted-foreground">{hint}</figcaption>
    </figure>
  )
}
