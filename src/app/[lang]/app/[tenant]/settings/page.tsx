import { ProfileForm } from '@/components/management/profile-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getTenantSubscription } from '@/lib/billing/queries'
import { formatMoney } from '@/lib/billing/schemas'
import { planPrice, SUBSCRIPTION_STATUS_VARIANT, usedOf } from '@/lib/billing/view'
import { localeMeta } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getTenantProfile } from '@/lib/management/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
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
  const live = !!ctx.tenantId && !ctx.user.isPreview
  const [profile, billing] = await Promise.all([ctx.tenantId ? getTenantProfile(ctx.tenantId) : null, live ? getTenantSubscription(slug) : null])
  const b = dict.billing

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
      {billing ? (
        <Card>
          <CardHeader>
            <CardTitle>{b.workspace.title}</CardTitle>
            <CardDescription>{billing.subscription ? b.statusHelp[billing.subscription.status] : b.workspace.none}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
              {[
                ...(billing.subscription
                  ? [
                      { label: b.subscription.plan, value: (locale === 'ar' && billing.subscription.plan_name_ar) || billing.subscription.plan_name },
                      { label: b.subscription.status, value: <Badge variant={SUBSCRIPTION_STATUS_VARIANT[billing.subscription.status] ?? 'neutral'}>{b.statuses[billing.subscription.status] ?? billing.subscription.status}</Badge> },
                      { label: b.workspace.price, value: planPrice(dict, locale, billing.subscription) },
                      ...(billing.subscription.trial_ends_at ? [{ label: b.subscription.trialEnds, value: formatDate(locale, billing.subscription.trial_ends_at, true) }] : []),
                      ...(billing.subscription.period_end ? [{ label: b.subscription.periodEnd, value: formatDate(locale, billing.subscription.period_end, true) }] : []),
                    ]
                  : []),
                { label: b.subscription.members, value: usedOf(dict, locale, billing.usage.members, billing.limits?.members) },
                { label: b.subscription.documents, value: usedOf(dict, locale, billing.usage.documents, billing.limits?.documents) },
                { label: b.subscription.aiMonth, value: usedOf(dict, locale, billing.usage.ai_month_usd, billing.limits?.ai_monthly_usd, true) },
              ].map((row) => (
                <div key={row.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
            {billing.payments ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">{b.workspace.payments}</h3>
                {billing.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{b.workspace.paymentsEmpty}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                    {billing.payments.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <span className="font-medium tabular-nums">{formatMoney(p.amount_minor, p.currency, locale)}</span>
                        <span className="text-muted-foreground">{b.subscription.methods[p.method] ?? p.method}</span>
                        {p.reference ? (
                          <code className="text-xs" dir="ltr">
                            {p.reference}
                          </code>
                        ) : null}
                        <span className="ms-auto text-xs text-muted-foreground">{formatDate(locale, p.paid_on)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{b.workspace.contact}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
