'use client'

import { useParams } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isLocale } from '@/lib/i18n/config'

// Client error boundaries cannot read server dictionaries, so keep a tiny local copy.
const COPY = {
  en: {
    title: 'Something went wrong',
    body: 'An unexpected error occurred. If it keeps happening, contact support and share the reference below.',
    reference: 'Reference',
    retry: 'Try again',
  },
  ar: {
    title: 'حدث خطأ ما',
    body: 'وقع خطأ غير متوقع. إذا تكرر ذلك، فتواصل مع الدعم وشارك الرقم المرجعي أدناه.',
    reference: 'الرقم المرجعي',
    retry: 'إعادة المحاولة',
  },
} as const

export function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  const params = useParams<{ lang?: string }>()
  const copy = COPY[isLocale(params?.lang) ? params.lang : 'en']
  // Server errors arrive with a generic message plus a digest that matches server logs.
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : ''

  return (
    <div role="alert" className="mx-auto w-full max-w-md rounded-card border border-border bg-card p-8 text-center shadow-xs">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-danger-subtle text-danger">
        <TriangleAlert aria-hidden className="size-5" />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
      {digest ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {copy.reference}: <span className="font-mono">{digest}</span>
        </p>
      ) : null}
      <Button className="mt-6" onClick={() => retry()}>
        {copy.retry}
      </Button>
    </div>
  )
}
