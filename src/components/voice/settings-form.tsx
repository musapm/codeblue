'use client'

import { useState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { updateVoiceSettings } from '@/lib/voice/actions'
import { VOICE_PROVIDERS, type VoiceProvider } from '@/lib/voice/schemas'

export function VoiceSettingsForm({
  tenant,
  initial,
  serverConnected,
  labels,
  messages,
}: {
  tenant: string
  initial: { enabled: boolean; inputEnabled: boolean; outputEnabled: boolean; provider: VoiceProvider; inputPrice: number | null; outputPrice: number | null; monthlyBudgetUsd: number; dailyMinutes: number }
  serverConnected: boolean
  labels: Record<
    'enabled' | 'input' | 'inputHint' | 'output' | 'provider' | 'serverMissing' | 'prices' | 'inputPrice' | 'outputPrice' | 'priceHint' | 'budget' | 'budgetHint' | 'dailyMinutes' | 'optional' | 'save' | 'saving',
    string
  > & { providers: Record<string, string>; providerHints: Record<string, string> }
  messages: FormMessages
}) {
  const [provider, setProvider] = useState<VoiceProvider>(initial.provider)
  return (
    <ActionForm action={updateVoiceSettings} hidden={{ tenant }} messages={messages}>
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="size-4 accent-primary" />
        {labels.enabled}
      </label>
      <div className="space-y-2 ps-7">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="inputEnabled" defaultChecked={initial.inputEnabled} className="mt-0.5 size-4 accent-primary" />
          <span>
            <span className="block font-medium">{labels.input}</span>
            <span className="block text-xs text-muted-foreground">{labels.inputHint}</span>
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" name="outputEnabled" defaultChecked={initial.outputEnabled} className="size-4 accent-primary" />
          {labels.output}
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{labels.provider}</legend>
        {VOICE_PROVIDERS.map((p) => (
          <label key={p} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-subtle/40">
            <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="block font-medium">{labels.providers[p]}</span>
              <span className="block text-xs text-muted-foreground">{labels.providerHints[p]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {provider === 'server' && !serverConnected ? <Alert variant="warning">{labels.serverMissing}</Alert> : null}

      {provider === 'server' ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{labels.prices}</legend>
          <p className="text-xs text-muted-foreground">{labels.priceHint}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField name="inputPrice" label={labels.inputPrice} optionalLabel={labels.optional}>
              <Input name="inputPrice" inputMode="decimal" defaultValue={initial.inputPrice ?? undefined} dir="ltr" className="max-w-40" />
            </FormField>
            <FormField name="outputPrice" label={labels.outputPrice} optionalLabel={labels.optional}>
              <Input name="outputPrice" inputMode="decimal" defaultValue={initial.outputPrice ?? undefined} dir="ltr" className="max-w-40" />
            </FormField>
            <FormField name="monthlyBudget" label={labels.budget} hint={labels.budgetHint}>
              <Input name="monthlyBudget" type="number" min={0} max={100000} step="0.01" inputMode="decimal" dir="ltr" className="max-w-40" defaultValue={initial.monthlyBudgetUsd} />
            </FormField>
            <FormField name="dailyMinutes" label={labels.dailyMinutes}>
              <Input name="dailyMinutes" type="number" min={1} max={600} step="1" inputMode="numeric" dir="ltr" className="max-w-32" defaultValue={initial.dailyMinutes} />
            </FormField>
          </div>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="inputPrice" value={initial.inputPrice ?? ''} />
          <input type="hidden" name="outputPrice" value={initial.outputPrice ?? ''} />
          <input type="hidden" name="monthlyBudget" value={initial.monthlyBudgetUsd} />
          <input type="hidden" name="dailyMinutes" value={initial.dailyMinutes} />
        </>
      )}
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}
