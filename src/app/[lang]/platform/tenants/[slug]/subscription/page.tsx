import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Ban, Play, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { assignPlanAction, recordPaymentAction, setLimitsAction, setSubscriptionStatusAction } from '@/lib/billing/actions'
import { getPlatformSubscription, listPlans } from '@/lib/billing/queries'
import { formatMoney, PAYMENT_METHODS } from '@/lib/billing/schemas'
import { BILLING_ROLES, planPrice, SUBSCRIPTION_STATUS_VARIANT, usedOf } from '@/lib/billing/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, TENANT_STATUS_VARIANT } from '@/lib/management/view'
import { requirePlatformAccess } from '@/lib/tenancy/context'

/** One university's subscription (platform billing staff): plan, status, limits, payments, history. */
export default async function SubscriptionPage({ params }: PageProps<'/[lang]/platform/tenants/[slug]/subscription'>) {
  const { slug } = await params
  const { locale, dict } = await getI18n()
  const { user, role } = await requirePlatformAccess(locale)
  if (user.isPreview || !BILLING_ROLES.includes(role ?? '')) notFound()
  const [data, plans] = await Promise.all([getPlatformSubscription(slug), listPlans()])
  if (!data) notFound()
  const { tenant, subscription: s, limits, usage, payments, events } = data
  const t = dict.billing.subscription
  const messages = formMessages(dict)
  const hidden = { slug: tenant.slug, locale }
  const archived = tenant.status === 'archived'
  const activePlans = plans.filter((p) => p.is_active)
  const plan = s ? plans.find((p) => p.key === s.plan_key) : undefined
  const today = new Date().toISOString().slice(0, 10)
  const optional = dict.common.optional

  return (
    <>
      <Link href={localizedPath(locale, `/platform/tenants/${tenant.slug}`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t.back}
      </Link>
      <PageHeader title={t.title(tenant.name)} badge={<Badge variant={TENANT_STATUS_VARIANT[tenant.status as keyof typeof TENANT_STATUS_VARIANT] ?? 'neutral'}>{dict.management.tenantStatus[tenant.status as keyof typeof dict.management.tenantStatus] ?? tenant.status}</Badge>} />
      <div className="space-y-6">
        {archived ? <Alert variant="warning">{dict.management.errors.closed}</Alert> : null}
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.current}</CardTitle>
              {s ? <CardDescription>{dict.billing.statusHelp[s.status]}</CardDescription> : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {!s ? (
                <p className="text-sm text-muted-foreground">{t.none}</p>
              ) : (
                <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                  {[
                    { label: t.plan, value: `${s.plan_name}${plan ? ` · ${planPrice(dict, locale, plan)}` : ''}` },
                    { label: t.status, value: <Badge variant={SUBSCRIPTION_STATUS_VARIANT[s.status] ?? 'neutral'}>{dict.billing.statuses[s.status] ?? s.status}</Badge> },
                    ...(s.trial_ends_at ? [{ label: t.trialEnds, value: formatDate(locale, s.trial_ends_at, true) }] : []),
                    ...(s.period_end ? [{ label: t.periodEnd, value: `${formatDate(locale, s.period_end, true)} · ${t.grace(s.grace_days)}` }] : []),
                  ].map((r) => (
                    <div key={r.label} className="flex flex-wrap justify-between gap-3 px-4 py-2.5">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="text-end">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div>
                <h3 className="mb-2 text-sm font-medium">{t.usage}</h3>
                <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                  {[
                    { label: t.members, value: usedOf(dict, locale, usage.members, limits?.members) },
                    { label: t.documents, value: usedOf(dict, locale, usage.documents, limits?.documents) },
                    { label: t.aiMonth, value: usedOf(dict, locale, usage.ai_month_usd, limits?.ai_monthly_usd, true) },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between gap-3 px-4 py-2.5">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="tabular-nums">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {s && !archived ? (
                <div className="flex flex-wrap gap-2">
                  {s.status === 'suspended' || s.status === 'expired' || s.status === 'cancelled' ? (
                    <ActionButton action={setSubscriptionStatusAction} hidden={{ ...hidden, status: 'active' }} messages={messages} label={t.reactivate} icon={<Play aria-hidden />} />
                  ) : null}
                  {s.status !== 'suspended' && s.status !== 'expired' ? (
                    <ActionButton action={setSubscriptionStatusAction} hidden={{ ...hidden, status: 'suspended' }} messages={messages} confirmMessage={t.confirmSuspend} label={t.suspend} variant="ghost" icon={<Ban aria-hidden />} />
                  ) : null}
                  {s.status === 'active' || s.status === 'past_due' ? (
                    <ActionButton action={setSubscriptionStatusAction} hidden={{ ...hidden, status: 'cancelled' }} messages={messages} confirmMessage={t.confirmCancel} label={t.cancel} variant="ghost" icon={<XCircle aria-hidden />} />
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {!archived ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.assign}</CardTitle>
                <CardDescription>{t.assignHint}</CardDescription>
              </CardHeader>
              <CardContent>
                {activePlans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    <Link href={localizedPath(locale, '/platform/plans')} className="text-primary hover:underline">
                      {t.noPlans}
                    </Link>
                  </p>
                ) : (
                  <ActionForm action={assignPlanAction} hidden={hidden} messages={messages}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField name="planKey" label={t.plan}>
                        <Select name="planKey" defaultValue={s?.plan_key ?? activePlans[0]!.key}>
                          {activePlans.map((p) => (
                            <option key={p.key} value={p.key}>
                              {(locale === 'ar' && p.name_ar) || p.name} · {planPrice(dict, locale, p)}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField name="mode" label={t.mode}>
                        <Select name="mode" defaultValue={s ? 'paid' : 'trial'}>
                          <option value="trial">{t.modes.trial}</option>
                          <option value="paid">{t.modes.paid}</option>
                        </Select>
                      </FormField>
                      <FormField name="months" label={t.months} optionalLabel={optional}>
                        <Input name="months" inputMode="numeric" defaultValue="12" dir="ltr" />
                      </FormField>
                      <FormField name="note" label={t.note} optionalLabel={optional}>
                        <Input name="note" maxLength={500} dir="auto" />
                      </FormField>
                    </div>
                    <SubmitButton pendingLabel={dict.management.saving}>{t.assignSubmit}</SubmitButton>
                  </ActionForm>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {s && !archived ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.payment}</CardTitle>
                <CardDescription>{t.paymentHint}</CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm action={recordPaymentAction} hidden={hidden} messages={messages} resetOnSuccess>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField name="amount" label={t.amount}>
                      <Input name="amount" inputMode="decimal" dir="ltr" required />
                    </FormField>
                    <FormField name="currency" label={t.currency}>
                      <Input name="currency" defaultValue={plan?.currency ?? undefined} maxLength={3} dir="ltr" className="uppercase" required />
                    </FormField>
                    <FormField name="method" label={t.method}>
                      <Select name="method" defaultValue="bank_transfer">
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {t.methods[m]}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField name="reference" label={t.reference} optionalLabel={optional}>
                      <Input name="reference" maxLength={120} dir="ltr" />
                    </FormField>
                    <FormField name="paidOn" label={t.paidOn}>
                      <Input name="paidOn" type="date" defaultValue={today} max={today} dir="ltr" required />
                    </FormField>
                    <FormField name="extendsMonths" label={t.extendsMonths} hint={t.extendsHint}>
                      <Input name="extendsMonths" inputMode="numeric" defaultValue={plan?.billing_interval === 'month' ? '1' : '12'} dir="ltr" required />
                    </FormField>
                    <FormField name="note" label={t.note} optionalLabel={optional} className="md:col-span-2">
                      <Input name="note" maxLength={500} dir="auto" />
                    </FormField>
                  </div>
                  <SubmitButton pendingLabel={dict.management.saving}>{t.recordSubmit}</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.limitsForm}</CardTitle>
                <CardDescription>{t.limitsHint}</CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm action={setLimitsAction} hidden={hidden} messages={messages}>
                  <div className="grid gap-4 md:grid-cols-3">
                    <FormField name="maxMembers" label={dict.billing.plans.fields.maxMembers} optionalLabel={optional}>
                      <Input name="maxMembers" inputMode="numeric" defaultValue={s.max_members_override ?? undefined} placeholder={plan?.max_members != null ? String(plan.max_members) : undefined} dir="ltr" />
                    </FormField>
                    <FormField name="maxDocuments" label={dict.billing.plans.fields.maxDocuments} optionalLabel={optional}>
                      <Input name="maxDocuments" inputMode="numeric" defaultValue={s.max_documents_override ?? undefined} placeholder={plan?.max_documents != null ? String(plan.max_documents) : undefined} dir="ltr" />
                    </FormField>
                    <FormField name="aiMonthlyUsd" label={dict.billing.plans.fields.aiMonthlyUsd} optionalLabel={optional}>
                      <Input name="aiMonthlyUsd" inputMode="decimal" defaultValue={s.ai_monthly_usd_override ?? undefined} placeholder={plan?.ai_monthly_usd != null ? String(plan.ai_monthly_usd) : undefined} dir="ltr" />
                    </FormField>
                    <FormField name="billingNotes" label={t.billingNotes} optionalLabel={optional} className="md:col-span-3">
                      <Textarea name="billingNotes" rows={3} maxLength={2000} defaultValue={s.billing_notes ?? undefined} dir="auto" />
                    </FormField>
                  </div>
                  <SubmitButton pendingLabel={dict.management.saving}>{t.saveLimits}</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.payments}</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.paymentsEmpty}</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {payments.map((p) => (
                    <li key={p.id ?? `${p.paid_on}-${p.amount_minor}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="font-medium tabular-nums">{formatMoney(p.amount_minor, p.currency, locale)}</span>
                      <span className="text-muted-foreground">{t.methods[p.method] ?? p.method}</span>
                      {p.reference ? (
                        <code className="text-xs" dir="ltr">
                          {p.reference}
                        </code>
                      ) : null}
                      <Badge variant="outline">{t.renews(p.extends_months)}</Badge>
                      <span className="ms-auto text-xs text-muted-foreground">{formatDate(locale, p.paid_on)}</span>
                      {p.note ? (
                        <p className="w-full text-xs text-muted-foreground" dir="auto">
                          {p.note}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.history}</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.historyEmpty}</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{t.events[e.kind] ?? e.kind}</span>
                      {e.plan_key ? (
                        <code className="text-xs" dir="ltr">
                          {e.plan_key}
                        </code>
                      ) : null}
                      {e.to_status ? (
                        <span className="text-muted-foreground">
                          {e.from_status ? `${dict.billing.statuses[e.from_status] ?? e.from_status} → ` : ''}
                          {dict.billing.statuses[e.to_status] ?? e.to_status}
                        </span>
                      ) : null}
                      {e.note ? (
                        <span className="text-xs text-muted-foreground" dir="auto">
                          ({e.note === 'automatic' ? t.automatic : e.note})
                        </span>
                      ) : null}
                      <span className="ms-auto text-xs text-muted-foreground">{formatDate(locale, e.created_at, true)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
