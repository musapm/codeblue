'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** While documents are being processed, re-read the page every few seconds (for ~3 minutes). */
export function AutoRefresh({ active, intervalMs = 4000, maxMs = 180_000 }: { active: boolean; intervalMs?: number; maxMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const started = Date.now()
    const id = setInterval(() => {
      if (Date.now() - started > maxMs) clearInterval(id)
      else router.refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs, maxMs, router])
  return null
}
