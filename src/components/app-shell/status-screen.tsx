import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/logo'
import { SubmitButton } from '@/components/forms/submit-button'
import { buttonClasses } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import { localizedPath, type Locale } from '@/lib/i18n/config'

/**
 * Full-page message for signed-in users who cannot enter a workspace (no membership yet,
 * suspended/archived university). Always offers sign-out, so nobody is ever stuck.
 */
export function StatusScreen({
  locale,
  dict,
  icon,
  title,
  body,
  email,
}: {
  locale: Locale
  dict: Dictionary
  icon: ReactNode
  title: string
  body: string
  email: string | null
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Link href={localizedPath(locale, '/')} className="rounded-md">
          <Logo />
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-md rounded-card border border-border bg-card p-8 text-center shadow-xs">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground [&_svg]:size-6">
            {icon}
          </div>
          <h1 className="mt-4 text-xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          {email ? (
            <p className="mt-4 text-xs text-muted-foreground">
              {dict.workspace.signedInAs}{' '}
              <span className="font-medium text-foreground" dir="ltr">
                {email}
              </span>
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <SubmitButton variant="primary" className="w-full sm:w-auto" pendingLabel={dict.common.loading}>
                {dict.common.signOut}
              </SubmitButton>
            </form>
            <Link href={localizedPath(locale, '/')} className={buttonClasses({ variant: 'secondary' })}>
              {dict.common.backHome}
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
