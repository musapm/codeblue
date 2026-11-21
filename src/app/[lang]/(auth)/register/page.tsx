import type { Metadata } from 'next'
import { AuthCard } from '@/components/auth/auth-card'
import { RegisterForm } from '@/components/auth/auth-forms'
import { getI18n } from '@/lib/i18n/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  return { title: dict.common.createAccount, robots: { index: false } }
}

export default async function RegisterPage() {
  const { locale, dict } = await getI18n()
  const configured = isSupabaseConfigured()
  return (
    <AuthCard title={dict.auth.register.title} subtitle={dict.auth.register.subtitle} configured={configured} dict={dict}>
      <RegisterForm locale={locale} enabled={configured} copy={{ auth: dict.auth, validation: dict.validation, loading: dict.common.loading }} />
    </AuthCard>
  )
}
