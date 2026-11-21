import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'

export default async function NotFound() {
  const { locale, dict } = await getI18n()
  return (
    <main id="main" className="flex min-h-[70vh] items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-card border border-border bg-card p-8 text-center shadow-xs">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
          <FileQuestion aria-hidden className="size-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">{dict.errors.notFoundTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{dict.errors.notFoundBody}</p>
        <Link href={localizedPath(locale, '/')} className={buttonClasses({ variant: 'secondary', className: 'mt-6' })}>
          {dict.common.backHome}
        </Link>
      </div>
    </main>
  )
}
