import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthCard, AuthFormSkeleton } from '@/components/auth/auth-card'
import { RegisterForm } from '@/components/auth/auth-forms'
import { getI18n } from '@/lib/i18n/server'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  return { title: dict.common.createAccount, robots: { index: false } }
}

export default async function RegisterPage({ searchParams }: PageProps<'/[lang]/register'>) {
  const { dict } = await getI18n()
  const configured = isSupabaseConfigured()
  return (
    <AuthCard title={dict.auth.register.title} subtitle={dict.auth.register.subtitle} configured={configured} dict={dict}>
      {/* searchParams are request-time data, so they stream in behind Suspense. */}
      <Suspense fallback={<AuthFormSkeleton />}>
        <RegisterFormWithParams searchParams={searchParams} configured={configured} />
      </Suspense>
    </AuthCard>
  )
}

async function RegisterFormWithParams({ searchParams, configured }: { searchParams: PageProps<'/[lang]/register'>['searchParams']; configured: boolean }) {
  const { locale, dict } = await getI18n()
  const params = await searchParams
  const next = typeof params.next === 'string' ? safeRedirectPath(params.next, '') || undefined : undefined
  return <RegisterForm locale={locale} enabled={configured} next={next} copy={{ auth: dict.auth, validation: dict.validation, loading: dict.common.loading }} />
}
