'use client'

import { useState, useTransition } from 'react'
import { setPreferenceAction } from '@/lib/notifications/actions'
import type { Preference } from '@/lib/notifications/schemas'

/** Per-kind choices, saved as they change. */
export function PreferencesTable({
  tenant,
  initial,
  labels,
  disabled,
}: {
  tenant: string
  initial: Preference[]
  labels: { kinds: Record<string, string>; inApp: string; email: string; saved: string; error: string }
  disabled?: boolean
}) {
  const [prefs, setPrefs] = useState(initial)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function change(kind: Preference['kind'], patch: Partial<Pick<Preference, 'inApp' | 'email'>>) {
    const before = prefs
    const next = prefs.map((p) => (p.kind === kind ? { ...p, ...patch } : p))
    const row = next.find((p) => p.kind === kind)!
    setPrefs(next)
    start(async () => {
      const result = await setPreferenceAction({ tenant, kind, inApp: row.inApp, email: row.email })
      if (result.status === 'success') setStatus(labels.saved)
      else {
        setPrefs(before)
        setStatus(labels.error)
      }
    })
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="py-2 text-start font-medium" />
            <th scope="col" className="w-28 py-2 text-center font-medium">
              {labels.inApp}
            </th>
            <th scope="col" className="w-28 py-2 text-center font-medium">
              {labels.email}
            </th>
          </tr>
        </thead>
        <tbody>
          {prefs.map((p) => {
            const name = labels.kinds[p.kind] ?? p.kind
            return (
              <tr key={p.kind} className="border-b border-border last:border-0">
                <th scope="row" className="py-2.5 text-start font-normal">
                  {name}
                </th>
                <td className="py-2.5 text-center">
                  <input type="checkbox" className="size-4 accent-primary" aria-label={`${name}: ${labels.inApp}`} checked={p.inApp} disabled={disabled || pending} onChange={(e) => change(p.kind, { inApp: e.target.checked })} />
                </td>
                <td className="py-2.5 text-center">
                  <input type="checkbox" className="size-4 accent-primary" aria-label={`${name}: ${labels.email}`} checked={p.email} disabled={disabled || pending} onChange={(e) => change(p.kind, { email: e.target.checked })} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="h-4 text-xs text-muted-foreground" role="status">
        {status}
      </p>
    </div>
  )
}
