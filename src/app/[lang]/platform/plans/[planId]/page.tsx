import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { PlanFields } from '@/components/billing/plan-fields'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { deletePlanAction, savePlanAction } from '@/lib/billing/actions'
import { listFeatureCatalog, listPlans } from '@/lib/billing/queries'
import { BILLING_ROLES } from '@/lib/billing/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formMessages } from '@/lib/management/view'
import { requirePlatformAccess } from '@/lib/tenancy/context'

export default async function PlanPage({ params }: PageProps<'/[lang]/platform/plans/[planId]'>) {
  const { planId } = await params
  const { locale, dict } = await getI18n()
  const { user, role } = await requirePlatformAccess(locale)
  if (user.isPreview || !BILLING_ROLES.includes(role ?? '')) notFound()
  const [plans, features] = await Promise.all([listPlans(), listFeatureCatalog()])
  const plan = plans.find((p) => p.id === planId)
  if (!plan) notFound()
  const t = dict.billing.plans
  const messages = formMessages(dict)

  return (
    <>
      <Link href={localizedPath(locale, '/platform/plans')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.back}
      </Link>
      <PageHeader
        title={(locale === 'ar' && plan.name_ar) || plan.name}
        badge={!plan.is_active ? <Badge>{t.inactive}</Badge> : undefined}
        description={t.subscribers(plan.subscribers)}
        actions={
          <ActionButton action={deletePlanAction} hidden={{ planId: plan.id, locale }} messages={messages} confirmMessage={t.confirmDelete} label={t.delete} variant="ghost" icon={<Trash2 aria-hidden />} />
        }
      />
      <Card>
        <CardContent className="pt-6">
          <ActionForm action={savePlanAction} hidden={{ planId: plan.id, locale }} messages={messages}>
            <PlanFields dict={dict} plan={plan} features={features} />
            <SubmitButton pendingLabel={dict.management.saving}>{t.save}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  )
}
