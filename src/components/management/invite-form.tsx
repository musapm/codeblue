'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { Alert } from '@/components/ui/alert'
import { Input, Select } from '@/components/ui/input'
import type { InviteResult } from '@/lib/management/workspace-actions'
import { inviteMember } from '@/lib/management/workspace-actions'
import { ActionForm, type FormMessages } from './action-form'
import { CopyField } from './copy-field'
import { FormField } from './form-field'

export type InviteFormLabels = {
  email: string
  role: string
  validity: string
  submit: string
  submitting: string
  noEmailYet: string
  /** Pre-rendered with {email} and {date} placeholders. */
  createdTemplate: string
  expiresTemplate: string
  copyOnce: string
  copy: string
  copied: string
  link: string
  dayOptions: { value: number; label: string }[]
}

/** Invitation form; the one-time link is rendered only in the inviter's browser memory. */
export function InviteForm({
  tenantSlug,
  locale,
  roles,
  defaultRole,
  labels,
  messages,
  disabled,
}: {
  tenantSlug: string
  locale: string
  roles: { key: string; label: string }[]
  defaultRole?: string
  labels: InviteFormLabels
  messages: FormMessages
  disabled?: boolean
}) {
  const format = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  return (
    <ActionForm<InviteResult>
      action={inviteMember}
      hidden={{ tenant: tenantSlug, locale }}
      messages={messages}
      resetOnSuccess
      renderSuccess={(data) =>
        data ? (
          <Alert variant="success" role="status" title={labels.createdTemplate.replace('{email}', data.email)}>
            <div className="mt-2 space-y-3">
              <p>{labels.copyOnce}</p>
              <CopyField value={data.link} label={labels.link} copyLabel={labels.copy} copiedLabel={labels.copied} />
              <p className="text-xs">{labels.expiresTemplate.replace('{date}', format(data.expiresAt))}</p>
            </div>
          </Alert>
        ) : null
      }
    >
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-[1fr_14rem_10rem]">
        <FormField name="email" label={labels.email}>
          <Input name="email" type="email" autoComplete="off" required maxLength={254} dir="ltr" />
        </FormField>
        <FormField name="roleKey" label={labels.role}>
          <Select name="roleKey" defaultValue={defaultRole ?? roles[roles.length - 1]?.key} required>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField name="validDays" label={labels.validity}>
          <Select name="validDays" defaultValue="7">
            {labels.dayOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel={labels.submitting} disabled={disabled}>
          {labels.submit}
        </SubmitButton>
        <p className="text-xs text-muted-foreground">{labels.noEmailYet}</p>
      </div>
    </ActionForm>
  )
}
