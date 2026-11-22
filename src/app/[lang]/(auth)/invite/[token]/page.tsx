import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AuthCard, AuthFormSkeleton } from '@/components/auth/auth-card'
import { SubmitButton } from '@/components/forms/submit-button'
import { AcceptInvitation } from '@/components/management/accept-invitation'
import { Alert } from '@/components/ui/alert'
import { buttonClasses } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'
import { getCurrentUser } from '@/lib/auth/session'
import { localizedPath, type Locale } from '@/lib/i18n/config'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import { getI18n } from '@/lib/i18n/server'
import { getInvitationPreview } from '@/lib/management/queries'
import { formatDate, formMessages, roleLabel } from '@/lib/management/view'
import { isSupabaseConfigured } from '@/lib/supabase/config'

// Per-user and per-token: there is nothing to prerender, so this route blocks on the server.
export const instant = false

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  // The token is a credential: never index the page or leak the URL in a Referer header.
  return { title: dict.management.invite.metaTitle, robots: { index: false, follow: false }, referrer: 'no-referrer' }
}

export default async function InvitationPage({ params }: PageProps<'/[lang]/invite/[token]'>) {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <InvitationContent params={params} />
    </Suspense>
  )
}

async function InvitationContent({ params }: { params: PageProps<'/[lang]/invite/[token]'>['params'] }) {
  const { token } = await params
  const { locale, dict } = await getI18n()
  const t = dict.management.invite
  const configured = isSupabaseConfigured()
  const user = configured ? await getCurrentUser() : null
  const invitePath = localizedPath(locale, `/invite/${encodeURIComponent(token)}`)
  const workspacesLink = (
    <Link href={localizedPath(locale, '/app')} className={buttonClasses({ variant: 'secondary', className: 'w-full' })}>
      {t.openWorkspaces}
    </Link>
  )

  if (!user) {
    return (
      <AuthCard title={t.signedOut.title} subtitle={t.signedOut.body} configured={configured} dict={dict}>
        {configured ? (
          <div className="flex flex-col gap-2">
            <Link href={`${localizedPath(locale, '/login')}?next=${encodeURIComponent(invitePath)}`} className={buttonClasses({ className: 'w-full' })}>
              {dict.common.signIn}
            </Link>
            <Link href={`${localizedPath(locale, '/register')}?next=${encodeURIComponent(invitePath)}`} className={buttonClasses({ variant: 'secondary', className: 'w-full' })}>
              {dict.common.createAccount}
            </Link>
          </div>
        ) : null}
      </AuthCard>
    )
  }

  const preview = user.isPreview ? null : await getInvitationPreview(token)
  if (!preview) {
    return (
      <AuthCard title={t.invalid.title} subtitle={t.invalid.body} configured={configured} dict={dict}>
        {workspacesLink}
      </AuthCard>
    )
  }

  if (preview.status !== 'pending') {
    const copy = t[preview.status]
    return (
      <AuthCard title={copy.title} subtitle={copy.body} configured={configured} dict={dict}>
        {workspacesLink}
      </AuthCard>
    )
  }

  const university = (locale === 'ar' && preview.tenant_name_translations.ar) || preview.tenant_name
  if (!preview.email_matches) {
    return (
      <AuthCard title={t.mismatch.title} configured={configured} dict={dict}>
        <Alert variant="warning">{t.mismatch.body(preview.email_hint, user.email ?? '')}</Alert>
        <SignOutButton locale={locale} dict={dict} next={invitePath} />
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t.valid.title(university)} subtitle={t.valid.body(roleLabel(dict, preview.role_key, preview.role_name))} configured={configured} dict={dict}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t.valid.expires(formatDate(locale, preview.expires_at, true))}</p>
        <AcceptInvitation token={token} locale={locale} label={t.valid.accept} pendingLabel={t.valid.accepting} messages={formMessages(dict)} />
      </div>
    </AuthCard>
  )
}

function SignOutButton({ locale, dict, next }: { locale: Locale; dict: Dictionary; next: string }) {
  return (
    <form action={signOut}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <SubmitButton className="w-full" pendingLabel={dict.common.loading}>
        {dict.common.signOut}
      </SubmitButton>
    </form>
  )
}
