/**
 * Horizontal bars, one row per category, value at the tip (order chosen by the caller: ranked
 * largest first unless the categories have a natural order). Label and value are text, so the
 * list reads the same without the bars. No state: a server component, so callers may pass a
 * formatting function.
 */
export function BarList({
  rows,
  emptyLabel,
  format = (n) => String(n),
}: {
  rows: { key: string; label: string; value: number }[]
  emptyLabel: string
  format?: (n: number) => string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,12rem)_1fr] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground" title={r.label} dir="auto">
            {r.label}
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="block h-3 rounded-e-[4px] bg-primary" style={{ width: `${r.value === 0 ? 0 : Math.max(1, (r.value / max) * 100)}%`, maxWidth: 'calc(100% - 3.5rem)' }} />
            <span className="font-medium tabular-nums">{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
