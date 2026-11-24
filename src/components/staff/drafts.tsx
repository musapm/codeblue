'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { createDraftAction } from '@/lib/staff/actions'

/** Client parts of the staff drafting tool. Only plain strings and records come from the server. */

type Option = { value: string; label: string }

export function DraftForm({
  tenant,
  locale,
  kinds,
  tones,
  languages,
  departments,
  labels,
  messages,
}: {
  tenant: string
  locale: 'en' | 'ar'
  kinds: Option[]
  tones: Option[]
  languages: Option[]
  departments: Option[]
  labels: Record<'kind' | 'audience' | 'audiencePlaceholder' | 'purpose' | 'purposePlaceholder' | 'tone' | 'language' | 'useDocuments' | 'department' | 'allDepartments' | 'submit' | 'submitting', string>
  messages: FormMessages
}) {
  const [kind, setKind] = useState(kinds[0]?.value ?? 'email')
  const [useDocuments, setUseDocuments] = useState(true)
  return (
    <ActionForm action={createDraftAction} hidden={{ tenant, locale, fallbackTitle: kinds.find((k) => k.value === kind)?.label }} messages={messages} showSuccess={false}>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField name="kind" label={labels.kind}>
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField name="tone" label={labels.tone}>
          <Select name="tone" defaultValue={tones[0]?.value}>
            {tones.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField name="language" label={labels.language}>
          <Select name="language" defaultValue={locale}>
            {languages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField name="audience" label={labels.audience}>
        <Input name="audience" maxLength={200} placeholder={labels.audiencePlaceholder} dir="auto" required />
      </FormField>
      <FormField name="purpose" label={labels.purpose}>
        <Textarea name="purpose" rows={5} maxLength={3000} placeholder={labels.purposePlaceholder} dir="auto" required />
      </FormField>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="useDocuments" checked={useDocuments} onChange={(e) => setUseDocuments(e.target.checked)} className="size-4 accent-primary" />
          {labels.useDocuments}
        </label>
        {useDocuments && departments.length > 0 ? (
          <FormField name="departmentId" label={labels.department} className="min-w-56">
            <Select name="departmentId" defaultValue="">
              <option value="">{labels.allDepartments}</option>
              {departments.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
      </div>
      <SubmitButton pendingLabel={labels.submitting}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}

/** Copy a draft's text. When the clipboard is blocked, the text stays selectable on the page. */
export function CopyButton({ text, labels }: { text: string; labels: { copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? labels.copied : labels.copy}</span>
    </Button>
  )
}
