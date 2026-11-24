import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AuthCard, AuthFormSkeleton } from '@/components/auth/auth-card'
import { VerifyCodeForm } from '@/components/auth/two-step'
import { signOut } from '@/lib/auth/actions'
import { getMfaState } from '@/lib/auth/mfa'
import { getCurrentUser } from '@/lib/auth/session'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  return { title: dict.auth.twoStep.verifyTitle, robots: { index: false } }
}

/** The code step of two-step sign-in (after the password). */
export default async function VerifyPage({ searchParams }: PageProps<'/[lang]/login/verify'>) {
  const { dict } = await getI18n()
  const configured = isSupabaseConfigured()
  return (
    <AuthCard title={dict.auth.twoStep.verifyTitle} subtitle={dict.auth.twoStep.verifySubtitle} configured={configured} dict={dict}>
      <Suspense fallback={<AuthFormSkeleton />}>
        <VerifyStep searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  )
}

async function VerifyStep({ searchParams }: { searchParams: PageProps<'/[lang]/login/verify'>['searchParams'] }) {
  const { locale, dict } = await getI18n()
  const params = await searchParams
  const next = typeof params.next === 'string' ? safeRedirectPath(params.next, '') || undefined : undefined
  const user = await getCurrentUser()
  if (!user || user.isPreview) redirect(localizedPath(locale, '/login'))
  const state = await getMfaState(await createSupabaseServerClient())
  if (state.current === 'aal2' || state.next !== 'aal2') redirect(next ?? localizedPath(locale, '/app'))
  return (
    <div className="space-y-5">
      <VerifyCodeForm locale={locale} next={next} copy={{ ...dict.auth.twoStep, loading: dict.common.loading }} />
      <form action={signOut} className="text-center">
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="text-sm font-medium text-primary hover:underline">
          {dict.auth.twoStep.signOutInstead}
        </button>
      </form>
    </div>
  )
}
