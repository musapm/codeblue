import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { PreferencesTable } from '@/components/notifications/preferences'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { writeMode } from '@/lib/management/view'
import { getEmailSender } from '@/lib/notifications/email'
import { getMyPreferences } from '@/lib/notifications/queries'
import { NOTIFICATION_KINDS } from '@/lib/notifications/schemas'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

/** Each person's choices: which notifications, in the app and by email. */
export default async function NotificationSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/notifications/settings'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { feature: ['ticketing', 'workflow_agent'] })
  const t = dict.integrations.preferences
  const { canWrite, notice } = writeMode(ctx, dict)
  const live = !!ctx.tenantId && !ctx.user.isPreview
  const prefs = live ? await getMyPreferences(slug) : NOTIFICATION_KINDS.map((kind) => ({ kind, inApp: true, email: false }))

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/notifications`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {dict.tickets.notifications.title}
      </Link>
      <PageHeader title={t.title} description={t.subtitle} />
      <div className="max-w-2xl space-y-4">
        {notice ? <Alert variant="info">{notice}</Alert> : null}
        {getEmailSender() === null ? <Alert variant="info">{t.emailNotConnected}</Alert> : null}
        <Card>
          <CardContent className="pt-6">
            <PreferencesTable tenant={slug} initial={prefs} disabled={!canWrite} labels={{ kinds: t.kinds, inApp: t.inApp, email: t.email, saved: t.saved, error: dict.management.errors.generic }} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
