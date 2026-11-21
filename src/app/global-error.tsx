'use client'

import './globals.css'

/** Last-resort boundary when the root layout itself fails. Renders its own document. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : ''
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-canvas p-6 font-sans">
        <title>Something went wrong</title>
        <main className="w-full max-w-md rounded-card border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">An unexpected error occurred. Please try again.</p>
          <p lang="ar" dir="rtl" className="mt-2 text-sm text-muted-foreground">
            حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.
          </p>
          {digest ? <p className="mt-4 font-mono text-xs text-muted-foreground">Reference: {digest}</p> : null}
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-[#1b4f8f] px-4 text-sm font-medium text-white"
          >
            Try again · إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  )
}
