'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Small, dependency-free charts for admissions analytics (single series, one hue: the
 * university's primary color). Specs from the dataviz guide: columns at most 24px wide with
 * a 4px rounded data end and a square baseline, a hairline baseline, values in a tooltip on
 * hover and keyboard focus, and a table view so nothing depends on hovering.
 */

export type ColumnDatum = { key: string; label: string; value: number; tooltip: string }

export function ColumnChart({ data, ariaLabel, tableLabels }: { data: ColumnDatum[]; ariaLabel: string; tableLabels: { show: string; period: string; value: string } }) {
  const [active, setActive] = useState<string | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { key: '', value: 0 })
  const last = data.at(-1)

  return (
    <figure className="space-y-3">
      <div role="group" aria-label={ariaLabel} className="relative flex h-40 items-end gap-1 border-b border-border pt-6" dir="ltr">
        {data.map((d) => {
          const labelled = d.key === last?.key || (d.key === peak.key && d.value > 0)
          return (
            <div
              key={d.key}
              tabIndex={0}
              aria-label={d.tooltip}
              onPointerEnter={() => setActive(d.key)}
              onPointerLeave={() => setActive((k) => (k === d.key ? null : k))}
              onFocus={() => setActive(d.key)}
              onBlur={() => setActive((k) => (k === d.key ? null : k))}
              className="group relative flex h-full flex-1 cursor-default flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {labelled ? <span className="mb-1 text-[0.7rem] font-medium text-muted-foreground tabular-nums">{d.value}</span> : null}
              <span
                aria-hidden
                className={cn('block w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity', active && active !== d.key ? 'opacity-60' : 'opacity-100')}
                style={{ height: `${d.value === 0 ? 0 : Math.max(2, (d.value / max) * 100)}%` }}
              />
              {active === d.key ? (
                <span role="tooltip" className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border border-border bg-card px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-sm">
                  <strong className="tabular-nums">{d.value}</strong> <span className="text-muted-foreground">{d.label}</span>
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[0.7rem] text-muted-foreground" dir="ltr">
        <span>{data[0]?.label}</span>
        <span>{last?.label}</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{tableLabels.show}</summary>
        <table className="mt-2 w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 text-start font-medium">
                {tableLabels.period}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {tableLabels.value}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((d) => (
              <tr key={d.key}>
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-end tabular-nums">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Horizontal bars, one row per category, value at the tip (order chosen by the caller). */
export function BarList({ rows, emptyLabel }: { rows: { key: string; label: string; value: number }[]; emptyLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.every((r) => r.value === 0)) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="flex items-center gap-2" aria-label={`${r.label}: ${r.value}`}>
            <span aria-hidden className="block h-3 rounded-e-[4px] bg-primary" style={{ width: `${r.value === 0 ? 0 : Math.max(1, (r.value / max) * 100)}%`, maxWidth: 'calc(100% - 3rem)' }} />
            <span className="font-medium tabular-nums">{r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
