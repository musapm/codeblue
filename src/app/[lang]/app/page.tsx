import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listWorkspacesForUser } from '@/lib/tenancy/context'

export const instant = false

export const metadata: Metadata = { robots: { index: false } }

/** Entry point after sign-in: opens the user's (first) university workspace. */
export default async function AppIndexPage() {
  const { locale, dict } = await getI18n()
  const { workspaces } = await listWorkspacesForUser(locale)
  const first = workspaces[0]
  if (first) redirect(localizedPath(locale, `/app/${first.slug}`))

  // Signed in, but not a member of any university yet (tenants arrive in Phase 2).
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <EmptyState
        className="max-w-lg bg-card"
        icon={<Building2 />}
        title={dict.workspace.universityWorkspace}
        description={dict.errors.notFoundBody}
      />
    </main>
  )
}
