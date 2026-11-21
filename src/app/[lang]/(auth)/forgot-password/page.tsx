import type { Metadata } from 'next'
import { AuthCard } from '@/components/auth/auth-card'
import { ForgotPasswordForm } from '@/components/auth/auth-forms'
import { getI18n } from '@/lib/i18n/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  return { title: dict.auth.forgot.title, robots: { index: false } }
}

export default async function ForgotPasswordPage() {
  const { locale, dict } = await getI18n()
  const configured = isSupabaseConfigured()
  return (
    <AuthCard title={dict.auth.forgot.title} subtitle={dict.auth.forgot.subtitle} configured={configured} dict={dict}>
      <ForgotPasswordForm locale={locale} enabled={configured} copy={{ auth: dict.auth, validation: dict.validation, loading: dict.common.loading }} />
    </AuthCard>
  )
}
