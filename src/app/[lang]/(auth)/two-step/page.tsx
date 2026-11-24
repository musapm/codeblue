import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AuthCard, AuthFormSkeleton } from '@/components/auth/auth-card'
import { RemoveTwoStep, TwoStepSetup } from '@/components/auth/two-step'
import { Alert } from '@/components/ui/alert'
import { getMfaState } from '@/lib/auth/mfa'
import { requireUser } from '@/lib/auth/session'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  return { title: dict.auth.twoStep.title, robots: { index: false } }
}

/** Setting up or removing two-step sign-in for one's own account. */
export default async function TwoStepPage({ searchParams }: PageProps<'/[lang]/two-step'>) {
  const { dict } = await getI18n()
  const configured = isSupabaseConfigured()
  return (
    <AuthCard title={dict.auth.twoStep.title} subtitle={dict.auth.twoStep.subtitle} configured={configured} dict={dict}>
      <Suspense fallback={<AuthFormSkeleton />}>
        <TwoStepContent searchParams={searchParams} configured={configured} />
      </Suspense>
    </AuthCard>
  )
}

async function TwoStepContent({ searchParams, configured }: { searchParams: PageProps<'/[lang]/two-step'>['searchParams']; configured: boolean }) {
  const { locale, dict } = await getI18n()
  const t = dict.auth.twoStep
  const copy = { ...t, loading: dict.common.loading }
  const params = await searchParams
  const required = params.required === 'platform'
  const back = (
    <Link href={localizedPath(locale, required ? '/platform' : '/app')} className="inline-block text-sm font-medium text-primary hover:underline">
      {t.back}
    </Link>
  )
  if (!configured) return back
  const user = await requireUser(locale, localizedPath(locale, '/two-step'))
  if (user.isPreview) return back
  const state = await getMfaState(await createSupabaseServerClient(), true)

  return (
    <div className="space-y-5">
      {required && !state.verifiedFactorId ? <Alert variant="warning" title={t.requiredPlatform} /> : null}
      {state.verifiedFactorId ? (
        <>
          <Alert variant="success" role="status" title={t.on} />
          {state.current === 'aal2' ? <RemoveTwoStep locale={locale} factorId={state.verifiedFactorId} copy={copy} /> : <p className="text-sm text-muted-foreground">{t.removeNeedsCode}</p>}
        </>
      ) : (
        <>
          <p className="text-sm">{t.off}</p>
          <TwoStepSetup next={required ? localizedPath(locale, '/platform') : undefined} copy={copy} />
        </>
      )}
      {back}
    </div>
  )
}
