import Link from 'next/link'
import { Layers } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { PlanFields } from '@/components/billing/plan-fields'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { savePlanAction } from '@/lib/billing/actions'
import { listFeatureCatalog, listPlans } from '@/lib/billing/queries'
import { BILLING_ROLES, formatCount, formatUsd, planPrice } from '@/lib/billing/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages } from '@/lib/management/view'
import { requirePlatformAccess } from '@/lib/tenancy/context'

/** Plans (platform owners, admins and billing staff): list and create. */
export default async function PlansPage() {
  const { locale, dict } = await getI18n()
  const { user, role } = await requirePlatformAccess(locale)
  const t = dict.billing.plans
  const allowed = !user.isPreview && BILLING_ROLES.includes(role ?? '')
  const [plans, features] = allowed ? await Promise.all([listPlans(), listFeatureCatalog()]) : [[], []]
  const base = localizedPath(locale, '/platform/plans')
  const limit = (n: number | null, money = false) => (n == null ? dict.billing.noLimit : money ? formatUsd(n, locale) : formatCount(n, locale))

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />
      <div className="space-y-6">
        {user.isPreview ? <Alert variant="info">{dict.management.previewNotice}</Alert> : !allowed ? <Alert variant="warning">{dict.billing.onlyBilling}</Alert> : null}
        <Card>
          <CardContent>
            {plans.length === 0 ? (
              <EmptyState icon={<Layers />} title={t.empty} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      {[t.columns.name, t.columns.price, t.columns.trial, t.columns.limits, t.columns.features, t.columns.subscribers].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2 text-start font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {plans.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-3">
                          <Link href={`${base}/${p.id}`} className="font-medium text-primary hover:underline">
                            {(locale === 'ar' && p.name_ar) || p.name}
                          </Link>
                          {!p.is_active ? <Badge className="ms-2">{t.inactive}</Badge> : null}
                          <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                            {p.key}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{planPrice(dict, locale, p)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{t.trial(p.trial_days)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{t.limitsLine(limit(p.max_members), limit(p.max_documents), limit(p.ai_monthly_usd, true))}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{t.featureCount(p.features.length)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{t.subscribers(p.subscribers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        {allowed ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.create}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={savePlanAction} hidden={{ locale }} messages={formMessages(dict)} showSuccess={false}>
                <PlanFields dict={dict} features={features} />
                <SubmitButton pendingLabel={dict.management.saving}>{t.createSubmit}</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
