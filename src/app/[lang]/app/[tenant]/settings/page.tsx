import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { localeMeta } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getWorkspaceContext } from '@/lib/tenancy/context'

export default async function GeneralSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/settings'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const { tenant } = await getWorkspaceContext(locale, slug)
  const t = dict.workspace.settings.general

  const rows = [
    { label: t.name, value: tenant.name },
    { label: t.slug, value: `/app/${tenant.slug}`, ltr: true },
    { label: t.defaultLanguage, value: localeMeta[tenant.defaultLocale].nativeName },
    { label: t.timezone, value: tenant.timezone, ltr: true },
  ]

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t.heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd className="text-sm font-medium" dir={row.ltr ? 'ltr' : undefined}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        <Alert variant="info">{t.readOnly}</Alert>
      </CardContent>
    </Card>
  )
}
