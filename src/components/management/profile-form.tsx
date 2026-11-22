'use client'

import { useId, useMemo } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { Input, Select } from '@/components/ui/input'
import { updateProfile } from '@/lib/management/workspace-actions'
import { ActionForm, type FormMessages } from './action-form'
import { FormField } from './form-field'

export type ProfileFormLabels = {
  nameEn: string
  nameAr: string
  nameHint: string
  defaultLanguage: string
  timezone: string
  timezoneHint: string
  supportEmail: string
  supportEmailHint: string
  optional: string
  submit: string
  saving: string
  languages: { en: string; ar: string }
}

export function ProfileForm({
  hidden,
  initial,
  labels,
  messages,
}: {
  hidden: Record<string, string | undefined>
  initial: { nameEn: string | null; nameAr: string | null; defaultLocale: 'en' | 'ar'; timezone: string; supportEmail: string | null }
  labels: ProfileFormLabels
  messages: FormMessages
}) {
  const listId = useId()
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return []
    }
  }, [])
  return (
    <ActionForm action={updateProfile} hidden={hidden} messages={messages}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="nameEn" label={labels.nameEn} hint={labels.nameHint} optionalLabel={labels.optional}>
          <Input name="nameEn" maxLength={160} defaultValue={initial.nameEn ?? undefined} />
        </FormField>
        <FormField name="nameAr" label={labels.nameAr} optionalLabel={labels.optional}>
          <Input name="nameAr" maxLength={160} dir="rtl" lang="ar" defaultValue={initial.nameAr ?? undefined} />
        </FormField>
        <FormField name="defaultLocale" label={labels.defaultLanguage}>
          <Select name="defaultLocale" defaultValue={initial.defaultLocale}>
            <option value="en">{labels.languages.en}</option>
            <option value="ar">{labels.languages.ar}</option>
          </Select>
        </FormField>
        <FormField name="timezone" label={labels.timezone} hint={labels.timezoneHint}>
          <Input name="timezone" required maxLength={64} dir="ltr" list={listId} defaultValue={initial.timezone} autoComplete="off" />
        </FormField>
        <FormField name="supportEmail" label={labels.supportEmail} hint={labels.supportEmailHint} optionalLabel={labels.optional} className="sm:col-span-2">
          <Input name="supportEmail" type="email" maxLength={254} dir="ltr" defaultValue={initial.supportEmail ?? undefined} />
        </FormField>
      </div>
      <datalist id={listId}>
        {['UTC', ...zones].map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <SubmitButton pendingLabel={labels.saving}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}
