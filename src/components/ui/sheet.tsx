'use client'

import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type SheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  closeLabel: string
  side?: 'start' | 'end'
  children: ReactNode
}

/** Slide-in panel for mobile navigation. Uses logical sides so it mirrors in RTL. */
export function Sheet({ open, onOpenChange, title, closeLabel, side = 'start', children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 z-50 flex w-[min(20rem,88vw)] flex-col bg-background shadow-xl outline-none',
            side === 'start' ? 'start-0 border-e border-border' : 'end-0 border-s border-border',
          )}
        >
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
              <X aria-hidden className="size-4" />
              <span className="sr-only">{closeLabel}</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div className="flex-1 overflow-y-auto p-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
