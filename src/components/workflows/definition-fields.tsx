import { FormField } from '@/components/management/form-field'
import { Input, Select, Textarea } from '@/components/ui/input'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import type { Definition } from '@/lib/workflows/queries'

/** The details of a form (title, address, description, department), for creating and editing. */
export function DefinitionFields({ dict, departments, definition }: { dict: Dictionary; departments: { value: string; label: string }[]; definition?: Definition }) {
  const f = dict.workflows.forms
  const optional = dict.common.optional
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField name="title" label={f.titleField}>
        <Input name="title" maxLength={160} defaultValue={definition?.title} dir="auto" required />
      </FormField>
      <FormField name="titleAr" label={f.titleAr} optionalLabel={optional}>
        <Input name="titleAr" maxLength={160} defaultValue={definition?.title_ar ?? undefined} dir="rtl" lang="ar" />
      </FormField>
      <FormField name="key" label={f.key} hint={f.keyHint}>
        <Input name="key" maxLength={48} defaultValue={definition?.key} dir="ltr" required pattern="[a-z0-9][a-z0-9\-]{1,47}" />
      </FormField>
      <FormField name="departmentId" label={f.department}>
        <Select name="departmentId" defaultValue={definition?.department_id ?? ''}>
          <option value="">{f.generalQueue}</option>
          {departments.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField name="description" label={f.description} optionalLabel={optional}>
        <Textarea name="description" rows={2} maxLength={1000} defaultValue={definition?.description ?? undefined} dir="auto" />
      </FormField>
      <FormField name="descriptionAr" label={f.descriptionAr} optionalLabel={optional}>
        <Textarea name="descriptionAr" rows={2} maxLength={1000} defaultValue={definition?.description_ar ?? undefined} dir="rtl" lang="ar" />
      </FormField>
    </div>
  )
}
