import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthCard, AuthFormSkeleton } from '@/components/auth/auth-card'
import { LoginForm } from '@/components/auth/auth-forms'
import { Alert } from '@/components/ui/alert'
import { getI18n } from '@/lib/i18n/server'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  return { title: dict.common.signIn, robots: { index: false } }
}

export default async function LoginPage({ searchParams }: PageProps<'/[lang]/login'>) {
  const { locale, dict } = await getI18n()
  const configured = isSupabaseConfigured()
  return (
    <AuthCard title={dict.auth.login.title} subtitle={dict.auth.login.subtitle} configured={configured} dict={dict}>
      {/* searchParams are request-time data, so they stream in behind Suspense. */}
      <Suspense fallback={<AuthFormSkeleton />}>
        <LoginFormWithParams searchParams={searchParams} locale={locale} configured={configured} />
      </Suspense>
    </AuthCard>
  )
}

async function LoginFormWithParams({
  searchParams,
  locale,
  configured,
}: {
  searchParams: PageProps<'/[lang]/login'>['searchParams']
  locale: Awaited<ReturnType<typeof getI18n>>['locale']
  configured: boolean
}) {
  const { dict } = await getI18n()
  const params = await searchParams
  const next = typeof params.next === 'string' ? safeRedirectPath(params.next, '') || undefined : undefined
  const linkError = params.error === 'link'
  return (
    <div className="space-y-5">
      {linkError ? <Alert variant="danger" role="alert" title={dict.auth.errors.linkExpired} /> : null}
      <LoginForm locale={locale} enabled={configured} next={next} copy={{ auth: dict.auth, validation: dict.validation, loading: dict.common.loading }} />
    </div>
  )
}
