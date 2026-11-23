'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Input, Textarea } from '@/components/ui/input'
import { updateAssistantSettings } from '@/lib/assistant/actions'

export type AssistantSettingsLabels = {
  enabled: string
  instructions: string
  instructionsHint: string
  budget: string
  budgetHint: string
  optional: string
  save: string
  saving: string
}

export function AssistantSettingsForm({
  tenant,
  initial,
  labels,
  messages,
}: {
  tenant: string
  initial: { enabled: boolean; instructions: string | null; monthlyBudgetUsd: number }
  labels: AssistantSettingsLabels
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateAssistantSettings} hidden={{ tenant }} messages={messages}>
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="size-4 accent-primary" />
        {labels.enabled}
      </label>
      <FormField name="instructions" label={labels.instructions} hint={labels.instructionsHint} optionalLabel={labels.optional}>
        <Textarea name="instructions" rows={5} maxLength={2000} dir="auto" defaultValue={initial.instructions ?? undefined} />
      </FormField>
      <FormField name="monthlyBudgetUsd" label={labels.budget} hint={labels.budgetHint}>
        <Input name="monthlyBudgetUsd" type="number" min={0} max={100000} step="0.01" inputMode="decimal" dir="ltr" className="max-w-40" defaultValue={initial.monthlyBudgetUsd} />
      </FormField>
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}
