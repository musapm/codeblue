'use client'

import { Check, Copy } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Read-only value with a copy button (used for one-time invitation links). */
export function CopyField({ value, label, copyLabel, copiedLabel }: { value: string; label: string; copyLabel: string; copiedLabel: string }) {
  const id = useId()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard blocked (permissions/insecure context): the field stays selectable.
      ;(document.getElementById(id) as HTMLInputElement | null)?.select()
    }
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly dir="ltr" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" onClick={copy} aria-live="polite">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  )
}
