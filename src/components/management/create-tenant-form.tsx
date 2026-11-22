'use client'

import Link from 'next/link'
import { useId, useMemo } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { Alert } from '@/components/ui/alert'
import { buttonClasses } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { createTenant, type CreateTenantResult } from '@/lib/management/platform-actions'
import { ActionForm, type FormMessages } from './action-form'
import { CopyField } from './copy-field'
import { FormField } from './form-field'

export type CreateTenantLabels = {
  name: string
  nameAr: string
  slug: string
  slugHint: string
  defaultLanguage: string
  timezone: string
  isDemo: string
  ownerEmail: string
  ownerHint: string
  optional: string
  submit: string
  submitting: string
  /** Pre-rendered with {slug} / {email} placeholders. */
  createdTemplate: string
  ownerLinkTemplate: string
  view: string
  copy: string
  copied: string
  link: string
  languages: { en: string; ar: string }
}

export function CreateTenantForm({ locale, labels, messages, detailBase }: { locale: string; labels: CreateTenantLabels; messages: FormMessages; detailBase: string }) {
  const listId = useId()
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return []
    }
  }, [])
  return (
    <ActionForm<CreateTenantResult>
      action={createTenant}
      hidden={{ locale }}
      messages={messages}
      resetOnSuccess
      renderSuccess={(data) =>
        data ? (
          <Alert variant="success" role="status" title={labels.createdTemplate.replace('{slug}', data.slug)}>
            <div className="mt-2 space-y-3">
              {data.ownerInviteLink && data.ownerEmail ? (
                <>
                  <p>{labels.ownerLinkTemplate.replace('{email}', data.ownerEmail)}</p>
                  <CopyField value={data.ownerInviteLink} label={labels.link} copyLabel={labels.copy} copiedLabel={labels.copied} />
                </>
              ) : null}
              <Link href={`${detailBase}/${data.slug}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                {labels.view}
              </Link>
            </div>
          </Alert>
        ) : null
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="name" label={labels.name}>
          <Input name="name" required minLength={2} maxLength={160} />
        </FormField>
        <FormField name="nameAr" label={labels.nameAr} optionalLabel={labels.optional}>
          <Input name="nameAr" maxLength={160} dir="rtl" lang="ar" />
        </FormField>
        <FormField name="slug" label={labels.slug} hint={labels.slugHint}>
          <Input name="slug" required maxLength={48} dir="ltr" autoComplete="off" />
        </FormField>
        <FormField name="ownerEmail" label={labels.ownerEmail} hint={labels.ownerHint} optionalLabel={labels.optional}>
          <Input name="ownerEmail" type="email" maxLength={254} dir="ltr" autoComplete="off" />
        </FormField>
        <FormField name="defaultLocale" label={labels.defaultLanguage}>
          <Select name="defaultLocale" defaultValue={locale === 'ar' ? 'ar' : 'en'}>
            <option value="en">{labels.languages.en}</option>
            <option value="ar">{labels.languages.ar}</option>
          </Select>
        </FormField>
        <FormField name="timezone" label={labels.timezone}>
          <Input name="timezone" required maxLength={64} dir="ltr" list={listId} defaultValue="UTC" autoComplete="off" />
        </FormField>
      </div>
      <datalist id={listId}>
        {['UTC', ...zones].map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" name="isDemo" className="size-4 rounded border-input accent-[var(--color-primary)]" />
        {labels.isDemo}
      </label>
      <SubmitButton pendingLabel={labels.submitting}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}
