import { notFound } from 'next/navigation'
import { PublicAdmissionsView } from '@/components/admissions/public-landing'
import { getPublicAdmissions } from '@/lib/admissions/visitor'
import { getSessionIdentity } from '@/lib/auth/session'
import { getI18n } from '@/lib/i18n/server'

export default async function PublicAdmissionsPage({ params, searchParams }: PageProps<'/[lang]/admissions/[tenant]'>) {
  const { tenant } = await params
  const { program } = await searchParams
  const { locale, dict } = await getI18n()
  const page = await getPublicAdmissions(tenant)
  if (!page) notFound()
  const session = await getSessionIdentity()
  return (
    <PublicAdmissionsView
      page={page}
      locale={locale}
      dict={dict}
      hasSession={Boolean(session)}
      requestedProgram={typeof program === 'string' ? program : null}
    />
  )
}
