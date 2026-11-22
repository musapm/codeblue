'use client'

import { ImageUp } from 'lucide-react'
import { SubmitButton } from '@/components/forms/submit-button'
import { uploadLogo } from '@/lib/management/workspace-actions'
import { ActionForm, type FormMessages } from './action-form'
import { FormField } from './form-field'

export function LogoUpload({
  hidden,
  messages,
  labels,
}: {
  hidden: Record<string, string | undefined>
  messages: FormMessages
  labels: { choose: string; upload: string; uploading: string; draftNote: string }
}) {
  return (
    <ActionForm action={uploadLogo} hidden={hidden} messages={messages} resetOnSuccess encType="multipart/form-data">
      <FormField name="logo" label={labels.choose} hint={labels.draftNote}>
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp"
          required
          className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
        />
      </FormField>
      <SubmitButton variant="secondary" pendingLabel={labels.uploading}>
        <ImageUp aria-hidden />
        {labels.upload}
      </SubmitButton>
    </ActionForm>
  )
}
