'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Input, Textarea } from '@/components/ui/input'
import { updateStaffSettings } from '@/lib/staff/actions'

export function StaffSettingsForm({
  tenant,
  initial,
  labels,
  messages,
}: {
  tenant: string
  initial: { enabled: boolean; instructions: string | null; monthlyBudgetUsd: number; dailyLimit: number }
  labels: Record<'enabled' | 'instructions' | 'instructionsHint' | 'budget' | 'budgetHint' | 'dailyLimit' | 'dailyLimitHint' | 'optional' | 'save' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateStaffSettings} hidden={{ tenant }} messages={messages}>
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="size-4 accent-primary" />
        {labels.enabled}
      </label>
      <FormField name="instructions" label={labels.instructions} hint={labels.instructionsHint} optionalLabel={labels.optional}>
        <Textarea name="instructions" rows={5} maxLength={2000} dir="auto" defaultValue={initial.instructions ?? undefined} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="monthlyBudget" label={labels.budget} hint={labels.budgetHint}>
          <Input name="monthlyBudget" type="number" min={0} max={100000} step="0.01" inputMode="decimal" dir="ltr" className="max-w-40" defaultValue={initial.monthlyBudgetUsd} />
        </FormField>
        <FormField name="dailyLimit" label={labels.dailyLimit} hint={labels.dailyLimitHint}>
          <Input name="dailyLimit" type="number" min={1} max={500} step="1" inputMode="numeric" dir="ltr" className="max-w-32" defaultValue={initial.dailyLimit} />
        </FormField>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}
