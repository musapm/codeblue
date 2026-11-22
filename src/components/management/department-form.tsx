'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { Input } from '@/components/ui/input'
import { saveDepartment } from '@/lib/management/workspace-actions'
import { ActionForm, type FormMessages } from './action-form'
import { FormField } from './form-field'

export type DepartmentFormLabels = {
  name: string
  nameAr: string
  slug: string
  slugHint: string
  email: string
  optional: string
  submit: string
  saving: string
}

/** Create (no `initial`) or edit a department. */
export function DepartmentForm({
  hidden,
  initial,
  labels,
  messages,
}: {
  hidden: Record<string, string | undefined>
  initial?: { id: string; name: string; nameAr: string | null; slug: string; email: string | null }
  labels: DepartmentFormLabels
  messages: FormMessages
}) {
  return (
    <ActionForm action={saveDepartment} hidden={{ ...hidden, id: initial?.id }} messages={messages} resetOnSuccess={!initial}>
      <div className="@container">
        <div className="grid gap-4 @lg:grid-cols-2">
          <FormField name="name" label={labels.name}>
            <Input name="name" required minLength={2} maxLength={120} defaultValue={initial?.name} />
          </FormField>
          <FormField name="nameAr" label={labels.nameAr} optionalLabel={labels.optional}>
            <Input name="nameAr" maxLength={120} dir="rtl" lang="ar" defaultValue={initial?.nameAr ?? undefined} />
          </FormField>
          <FormField name="slug" label={labels.slug} hint={labels.slugHint}>
            <Input name="slug" required maxLength={48} dir="ltr" defaultValue={initial?.slug} />
          </FormField>
          <FormField name="email" label={labels.email} optionalLabel={labels.optional}>
            <Input name="email" type="email" maxLength={254} dir="ltr" defaultValue={initial?.email ?? undefined} />
          </FormField>
        </div>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}
