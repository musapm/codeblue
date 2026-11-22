import { ProfileForm } from '@/components/management/profile-form'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { localeMeta } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getTenantProfile } from '@/lib/management/queries'
import { formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission } from '@/lib/tenancy/context'

export default async function GeneralSettingsPage({ params }: PageProps<'/[lang]/app/[tenant]/settings'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  const { tenant } = ctx
  const t = dict.workspace.settings.general
  const s = dict.management.settings
  const { canWrite, notice } = writeMode(ctx, dict)
  const canManage = canWrite && hasWorkspacePermission(ctx, 'tenant.settings.manage')
  const profile = ctx.tenantId ? await getTenantProfile(ctx.tenantId) : null

  const rows = [
    { label: t.name, value: tenant.name },
    ...(profile && profile.name !== tenant.name ? [{ label: s.registeredName, value: profile.name }] : []),
    { label: t.slug, value: `/app/${tenant.slug}`, ltr: true },
    { label: t.defaultLanguage, value: localeMeta[tenant.defaultLocale].nativeName },
    { label: t.timezone, value: tenant.timezone, ltr: true },
    ...(profile?.supportEmail ? [{ label: s.supportEmail, value: profile.supportEmail, ltr: true }] : []),
  ]

  return (
    <div className="max-w-3xl space-y-6">
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>{t.heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {canManage && profile ? (
            <>
              <dl className="rounded-lg border border-border">
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
                  <dt className="text-sm text-muted-foreground">{s.registeredName}</dt>
                  <dd className="text-sm">
                    <span className="font-medium">{profile.name}</span>
                    <span className="text-muted-foreground"> · {s.registeredNameHint}</span>
                  </dd>
                </div>
                <div className="grid gap-1 border-t border-border px-4 py-3 sm:grid-cols-[12rem_1fr]">
                  <dt className="text-sm text-muted-foreground">{t.slug}</dt>
                  <dd className="text-sm font-medium" dir="ltr">
                    /app/{tenant.slug}
                  </dd>
                </div>
              </dl>
              <ProfileForm
                hidden={{ tenant: slug, tenantId: ctx.tenantId ?? undefined, locale }}
                initial={profile}
                messages={formMessages(dict)}
                labels={{
                  nameEn: s.nameEn,
                  nameAr: s.nameAr,
                  nameHint: s.nameHint,
                  defaultLanguage: s.defaultLanguage,
                  timezone: s.timezone,
                  timezoneHint: s.timezoneHint,
                  supportEmail: s.supportEmail,
                  supportEmailHint: s.supportEmailHint,
                  optional: dict.common.optional,
                  submit: s.submit,
                  saving: dict.management.saving,
                  languages: s.languages,
                }}
              />
            </>
          ) : (
            <>
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
              {canWrite ? <Alert variant="info">{dict.management.readOnlyNotice}</Alert> : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
