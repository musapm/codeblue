'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Select, Textarea } from '@/components/ui/input'
import { saveQualityReview } from '@/lib/analytics/actions'

/** Outcome + note for one flagged answer, or for a group of identical unanswered questions. */
export function ReviewForm({
  tenant,
  messageIds,
  outcomes,
  initial,
  labels,
  messages,
}: {
  tenant: string
  messageIds: string[]
  outcomes: { value: string; label: string }[]
  initial?: { outcome: string; note: string | null }
  labels: { outcome: string; note: string; optional: string; submit: string; saving: string }
  messages: FormMessages
}) {
  return (
    <ActionForm action={saveQualityReview} hidden={{ tenant, messageIds: messageIds.join(',') }} messages={messages} showSuccess={false}>
      <div className="grid gap-3 sm:grid-cols-[minmax(12rem,16rem)_1fr]">
        <FormField name="outcome" label={labels.outcome}>
          <Select name="outcome" required defaultValue={initial?.outcome ?? ''}>
            <option value="" disabled>
              —
            </option>
            {outcomes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField name="note" label={labels.note} optionalLabel={labels.optional}>
          <Textarea name="note" rows={1} maxLength={2000} dir="auto" defaultValue={initial?.note ?? ''} className="min-h-10" />
        </FormField>
      </div>
      <SubmitButton size="sm" pendingLabel={labels.saving}>
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}
