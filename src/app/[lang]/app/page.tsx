import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { StatusScreen } from '@/components/app-shell/status-screen'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listWorkspacesForUser } from '@/lib/tenancy/context'

export const instant = false

export const metadata: Metadata = { robots: { index: false } }

/** Entry point after sign-in: opens the user's (first) university workspace. */
export default async function AppIndexPage() {
  const { locale, dict } = await getI18n()
  const { user, workspaces } = await listWorkspacesForUser(locale)
  const first = workspaces[0]
  if (first) redirect(localizedPath(locale, `/app/${first.slug}`))

  // Signed in, but not (yet) an active member of any university.
  return (
    <StatusScreen
      locale={locale}
      dict={dict}
      icon={<Building2 />}
      title={dict.workspace.noAccess.title}
      body={dict.workspace.noAccess.body}
      email={user.email}
    />
  )
}
