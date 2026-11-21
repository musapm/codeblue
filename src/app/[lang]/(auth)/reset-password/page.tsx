import type { Metadata } from 'next'
import { AuthCard } from '@/components/auth/auth-card'
import { ResetPasswordForm } from '@/components/auth/auth-forms'
import { getI18n } from '@/lib/i18n/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n()
  return { title: dict.auth.reset.title, robots: { index: false } }
}

/**
 * Reached from the password-recovery email (via /auth/callback, which establishes a
 * short-lived recovery session). The update action re-verifies that session server-side.
 */
export default async function ResetPasswordPage() {
  const { locale, dict } = await getI18n()
  const configured = isSupabaseConfigured()
  return (
    <AuthCard title={dict.auth.reset.title} subtitle={dict.auth.reset.subtitle} configured={configured} dict={dict}>
      <ResetPasswordForm locale={locale} enabled={configured} copy={{ auth: dict.auth, validation: dict.validation, loading: dict.common.loading }} />
    </AuthCard>
  )
}
