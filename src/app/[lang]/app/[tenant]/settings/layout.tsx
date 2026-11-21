import { PageHeader } from '@/components/app-shell/page-header'
import { SettingsTabs } from '@/components/app-shell/settings-tabs'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'

export default async function SettingsLayout({ children, params }: LayoutProps<'/[lang]/app/[tenant]/settings'>) {
  const { tenant } = await params
  const { locale, dict } = await getI18n()
  const base = localizedPath(locale, `/app/${tenant}/settings`)
  const t = dict.workspace.settings

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />
      <SettingsTabs
        tabs={[
          { href: base, label: t.tabs.general, exact: true },
          { href: `${base}/branding`, label: t.tabs.branding },
        ]}
      />
      <div className="mt-6">{children}</div>
    </>
  )
}
