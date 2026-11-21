'use client'

import { ErrorPanel } from '@/components/errors/error-panel'

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="main" className="flex min-h-[70vh] items-center justify-center bg-canvas p-6">
      <ErrorPanel error={error} retry={retry} />
    </main>
  )
}
