'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { acceptInvitation } from '@/lib/management/workspace-actions'
import { ActionForm, type FormMessages } from './action-form'

export function AcceptInvitation({ token, locale, label, pendingLabel, messages }: { token: string; locale: string; label: string; pendingLabel: string; messages: FormMessages }) {
  return (
    <ActionForm action={acceptInvitation} hidden={{ token, locale }} messages={messages} showSuccess={false}>
      <SubmitButton className="w-full" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </ActionForm>
  )
}
