'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Input } from '@/components/ui/input'
import { updateCampusSettings } from '@/lib/campus/actions'

export function CampusSettingsForm({
  tenant,
  initial,
  labels,
  messages,
}: {
  tenant: string
  initial: { aiEnabled: boolean; monthlyBudgetUsd: number; dailyLimit: number }
  labels: Record<'enabled' | 'budget' | 'budgetHint' | 'dailyLimit' | 'save' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateCampusSettings} hidden={{ tenant }} messages={messages}>
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" name="aiEnabled" defaultChecked={initial.aiEnabled} className="size-4 accent-primary" />
        {labels.enabled}
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="monthlyBudget" label={labels.budget} hint={labels.budgetHint}>
          <Input name="monthlyBudget" type="number" min={0} max={100000} step="0.01" inputMode="decimal" dir="ltr" className="max-w-40" defaultValue={initial.monthlyBudgetUsd} />
        </FormField>
        <FormField name="dailyLimit" label={labels.dailyLimit}>
          <Input name="dailyLimit" type="number" min={1} max={200} step="1" inputMode="numeric" dir="ltr" className="max-w-32" defaultValue={initial.dailyLimit} />
        </FormField>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}
