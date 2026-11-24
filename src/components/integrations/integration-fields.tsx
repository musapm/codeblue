import { FormField } from '@/components/management/form-field'
import { Input, Select, Textarea } from '@/components/ui/input'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import { configLines, INTEGRATION_KINDS } from '@/lib/integrations/schemas'
import type { Integration } from '@/lib/integrations/queries'

export function IntegrationFields({ dict, integration }: { dict: Dictionary; integration?: Integration }) {
  const t = dict.integrations
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {integration ? (
        <input type="hidden" name="kind" value={integration.kind} />
      ) : (
        <FormField name="kind" label={t.fields.kind}>
          <Select name="kind" defaultValue="lms">
            {INTEGRATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.kinds[k]}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField name="name" label={t.fields.name}>
        <Input name="name" maxLength={120} defaultValue={integration?.name} dir="auto" required />
      </FormField>
      <FormField name="config" label={t.fields.config} hint={t.fields.configHint} optionalLabel={dict.common.optional} className="md:col-span-2">
        <Textarea name="config" rows={4} defaultValue={integration ? configLines(integration.config) : undefined} dir="ltr" className="font-mono text-xs" />
      </FormField>
      <FormField name="secretRef" label={t.fields.secretRef} hint={t.fields.secretRefHint} optionalLabel={dict.common.optional}>
        <Input name="secretRef" maxLength={64} defaultValue={integration?.secret_ref ?? undefined} dir="ltr" className="font-mono" autoComplete="off" />
      </FormField>
    </div>
  )
}
