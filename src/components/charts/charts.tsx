'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Small, dependency-free charts (single series, one hue: the university's primary color).
 * Specs from the dataviz guide: columns at most 24px wide with a 4px rounded data end and a
 * square baseline, a hairline baseline, selective labels (the last value and the peak), values
 * in a tooltip on hover and keyboard focus, and a table view so nothing depends on hovering.
 */

export type ColumnDatum = { key: string; label: string; value: number; tooltip: string }

export function ColumnChart({
  data,
  ariaLabel,
  tableLabels,
  extraColumns = [],
}: {
  data: ColumnDatum[]
  ariaLabel: string
  tableLabels: { show: string; period: string; value: string }
  /** More values per period, shown only in the table view (e.g. resolved next to created). */
  extraColumns?: { label: string; values: number[] }[]
}) {
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
              role="img"
              tabIndex={0}
              aria-label={d.tooltip}
              onPointerEnter={() => setActive(d.key)}
              onPointerLeave={() => setActive((k) => (k === d.key ? null : k))}
              onFocus={() => setActive(d.key)}
              onBlur={() => setActive((k) => (k === d.key ? null : k))}
              className="group relative flex h-full flex-1 cursor-default flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {labelled ? (
                <span aria-hidden className="mb-1 text-[0.7rem] font-medium text-muted-foreground tabular-nums">
                  {d.value}
                </span>
              ) : null}
              <span
                aria-hidden
                className={cn('block w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity', active && active !== d.key ? 'opacity-60' : 'opacity-100')}
                style={{ height: `${d.value === 0 ? 0 : Math.max(2, (d.value / max) * 100)}%` }}
              />
              {active === d.key ? (
                <span aria-hidden className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border border-border bg-card px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-sm">
                  <strong className="tabular-nums">{d.value}</strong> <span className="text-muted-foreground">{d.label}</span>
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
      <div aria-hidden className="flex justify-between text-[0.7rem] text-muted-foreground" dir="ltr">
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
              {extraColumns.map((c) => (
                <th key={c.label} scope="col" className="py-1 text-end font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((d, i) => (
              <tr key={d.key}>
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-end tabular-nums">{d.value}</td>
                {extraColumns.map((c) => (
                  <td key={c.label} className="py-1 text-end tabular-nums">
                    {c.values[i] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
