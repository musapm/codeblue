import { ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SettingsTabs } from '@/components/app-shell/settings-tabs'
import { buttonClasses } from '@/components/ui/button'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function AdmissionsLayout({ children, params }: LayoutProps<'/[lang]/app/[tenant]/admissions'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'leads.read', feature: 'admissions_agent' })
  const a = dict.admissions
  const base = localizedPath(locale, `/app/${slug}/admissions`)
  const canPrograms = hasWorkspacePermission(ctx, 'programs.manage')
  const canSettings = canPrograms || hasWorkspacePermission(ctx, 'assistant.configure')

  return (
    <>
      <PageHeader
        title={a.title}
        description={a.subtitle}
        actions={
          <a href={localizedPath(locale, `/admissions/${slug}`)} target="_blank" rel="noopener" className={buttonClasses({ variant: 'secondary' })}>
            <ExternalLink aria-hidden />
            {a.publicLink}
          </a>
        }
      />
      <SettingsTabs
        tabs={[
          { href: base, label: a.tabs.leads!, exact: true, also: [`${base}/leads/`] },
          ...(canPrograms ? [{ href: `${base}/programs`, label: a.tabs.programs! }] : []),
          { href: `${base}/analytics`, label: a.tabs.analytics! },
          ...(canSettings ? [{ href: `${base}/settings`, label: a.tabs.settings! }] : []),
        ]}
      />
      <div className="mt-6">{children}</div>
    </>
  )
}
