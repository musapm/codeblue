import { FormField } from '@/components/management/form-field'
import { Input, Select, Textarea } from '@/components/ui/input'
import type { Plan } from '@/lib/billing/queries'
import { toMajor } from '@/lib/billing/schemas'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'

export function PlanFields({ dict, plan, features }: { dict: Dictionary; plan?: Plan; features: { key: string; description: string }[] }) {
  const f = dict.billing.plans.fields
  const optional = dict.common.optional
  const included = new Set(plan?.features ?? [])
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField name="key" label={f.key} hint={f.keyHint}>
          <Input name="key" defaultValue={plan?.key} readOnly={!!plan} maxLength={40} dir="ltr" className="font-mono" required />
        </FormField>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={plan?.is_active ?? true} className="size-4 accent-primary" />
          {f.isActive}
        </label>
        <FormField name="name" label={f.name}>
          <Input name="name" defaultValue={plan?.name} maxLength={80} required />
        </FormField>
        <FormField name="nameAr" label={f.nameAr} optionalLabel={optional}>
          <Input name="nameAr" defaultValue={plan?.name_ar ?? undefined} maxLength={80} dir="rtl" lang="ar" />
        </FormField>
        <FormField name="description" label={f.description} optionalLabel={optional} className="md:col-span-2">
          <Textarea name="description" defaultValue={plan?.description ?? undefined} rows={2} maxLength={1000} dir="auto" />
        </FormField>
        <FormField name="price" label={f.price} hint={f.priceHint} optionalLabel={optional}>
          <Input name="price" inputMode="decimal" defaultValue={plan?.price_minor != null && plan.currency ? toMajor(plan.price_minor, plan.currency) : undefined} dir="ltr" />
        </FormField>
        <FormField name="currency" label={f.currency} hint={f.currencyHint} optionalLabel={optional}>
          <Input name="currency" defaultValue={plan?.currency ?? undefined} maxLength={3} dir="ltr" className="uppercase" />
        </FormField>
        <FormField name="interval" label={f.interval}>
          <Select name="interval" defaultValue={plan?.billing_interval ?? 'year'}>
            <option value="year">{f.intervals.year}</option>
            <option value="month">{f.intervals.month}</option>
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField name="trialDays" label={f.trialDays}>
            <Input name="trialDays" inputMode="numeric" defaultValue={String(plan?.trial_days ?? 30)} dir="ltr" required />
          </FormField>
          <FormField name="graceDays" label={f.graceDays} hint={f.graceHint}>
            <Input name="graceDays" inputMode="numeric" defaultValue={String(plan?.grace_days ?? 14)} dir="ltr" required />
          </FormField>
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{f.limitsTitle}</legend>
        <p className="text-xs text-muted-foreground">{f.limitsHint}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <FormField name="maxMembers" label={f.maxMembers} optionalLabel={optional}>
            <Input name="maxMembers" inputMode="numeric" defaultValue={plan?.max_members ?? undefined} dir="ltr" />
          </FormField>
          <FormField name="maxDocuments" label={f.maxDocuments} optionalLabel={optional}>
            <Input name="maxDocuments" inputMode="numeric" defaultValue={plan?.max_documents ?? undefined} dir="ltr" />
          </FormField>
          <FormField name="aiMonthlyUsd" label={f.aiMonthlyUsd} optionalLabel={optional}>
            <Input name="aiMonthlyUsd" inputMode="decimal" defaultValue={plan?.ai_monthly_usd ?? undefined} dir="ltr" />
          </FormField>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{f.features}</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <label key={feature.key} className="flex items-start gap-2 rounded-md border border-border p-2.5 text-sm">
              <input type="checkbox" name="features" value={feature.key} defaultChecked={included.has(feature.key)} className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="block">{feature.description}</span>
                <code className="text-xs text-muted-foreground" dir="ltr">
                  {feature.key}
                </code>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
