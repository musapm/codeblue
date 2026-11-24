'use client'

import { useState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { saveLocationAction } from '@/lib/campus/actions'
import { ACCESS_KEYS, formatDayRanges, KINDS, type Access, type Day, type Hours, type Kind } from '@/lib/campus/schemas'

/** Create or edit a campus location. Only plain data and strings come from the server. */

export type LocationFormValues = {
  kind: Kind
  name: string
  name_ar: string | null
  code: string | null
  description: string | null
  description_ar: string | null
  parent_id: string | null
  floor: string | null
  department_id: string | null
  latitude: number | null
  longitude: number | null
  hours: Hours | null
  hours_note: string | null
  hours_note_ar: string | null
  access: Access
  accessibility_note: string | null
  accessibility_note_ar: string | null
  phone: string | null
  email: string | null
  url: string | null
  aliases: string[]
}

export type LocationFormLabels = {
  sections: Record<string, string>
  fields: Record<string, string>
  hints: Record<string, string>
  kinds: Record<string, string>
  days: Record<string, string>
  access: Record<string, string>
  accessValues: { yes: string; no: string; unknown: string }
  optional: string
  submit: string
  saving: string
}

export function LocationForm({
  tenant,
  locale,
  locationId,
  initial,
  buildings,
  departments,
  dayOrder,
  labels,
  messages,
}: {
  tenant: string
  locale: 'en' | 'ar'
  locationId?: string
  initial?: LocationFormValues
  buildings: { value: string; label: string }[]
  departments: { value: string; label: string }[]
  dayOrder: readonly Day[]
  labels: LocationFormLabels
  messages: FormMessages
}) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'building')
  const [hoursKnown, setHoursKnown] = useState(initial ? initial.hours !== null : false)
  const f = labels.fields
  const opt = labels.optional
  const section = (title: string) => <h3 className="border-b border-border pb-1 text-sm font-semibold">{title}</h3>

  return (
    <ActionForm action={saveLocationAction} hidden={{ tenant, locale, locationId }} messages={messages} className="space-y-6">
      <fieldset className="space-y-4">
        {section(labels.sections.basics!)}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField name="kind" label={f.kind}>
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {labels.kinds[k] ?? k}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField name="code" label={f.code} hint={labels.hints.code} optionalLabel={opt}>
            <Input name="code" maxLength={20} defaultValue={initial?.code ?? undefined} dir="ltr" />
          </FormField>
          <FormField name="name" label={f.name}>
            <Input name="name" maxLength={160} defaultValue={initial?.name} dir="auto" required />
          </FormField>
          <FormField name="nameAr" label={f.nameAr} optionalLabel={opt}>
            <Input name="nameAr" maxLength={160} defaultValue={initial?.name_ar ?? undefined} dir="rtl" lang="ar" />
          </FormField>
          <FormField name="description" label={f.description} optionalLabel={opt}>
            <Textarea name="description" rows={2} maxLength={1000} defaultValue={initial?.description ?? undefined} dir="auto" />
          </FormField>
          <FormField name="descriptionAr" label={f.descriptionAr} optionalLabel={opt}>
            <Textarea name="descriptionAr" rows={2} maxLength={1000} defaultValue={initial?.description_ar ?? undefined} dir="rtl" lang="ar" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        {section(labels.sections.place!)}
        <div className="grid gap-4 md:grid-cols-2">
          {kind !== 'building' ? (
            <FormField name="parentId" label={f.parentId}>
              <Select name="parentId" defaultValue={initial?.parent_id ?? ''}>
                <option value="">{f.noBuilding}</option>
                {buildings.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {kind !== 'building' ? (
            <FormField name="floor" label={f.floor} optionalLabel={opt}>
              <Input name="floor" maxLength={20} defaultValue={initial?.floor ?? undefined} dir="auto" className="max-w-40" />
            </FormField>
          ) : null}
          <FormField name="departmentId" label={f.departmentId}>
            <Select name="departmentId" defaultValue={initial?.department_id ?? ''}>
              <option value="">{f.noDepartment}</option>
              {departments.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="latitude" label={f.latitude} hint={labels.hints.coordinates} optionalLabel={opt}>
            <Input name="latitude" inputMode="decimal" defaultValue={initial?.latitude ?? undefined} dir="ltr" className="max-w-48" />
          </FormField>
          <FormField name="longitude" label={f.longitude} optionalLabel={opt}>
            <Input name="longitude" inputMode="decimal" defaultValue={initial?.longitude ?? undefined} dir="ltr" className="max-w-48" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        {section(labels.sections.hours!)}
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" name="hoursKnown" checked={hoursKnown} onChange={(e) => setHoursKnown(e.target.checked)} className="size-4 accent-primary" />
          {f.hoursKnown}
        </label>
        {hoursKnown ? (
          <>
            <p className="text-xs text-muted-foreground">{labels.hints.hours}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {dayOrder.map((d) => (
                <FormField key={d} name={`hours_${d}`} label={labels.days[d] ?? d}>
                  <Input name={`hours_${d}`} defaultValue={formatDayRanges(initial?.hours?.[d])} dir="ltr" />
                </FormField>
              ))}
            </div>
          </>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField name="hoursNote" label={f.hoursNote} optionalLabel={opt}>
            <Input name="hoursNote" maxLength={300} defaultValue={initial?.hours_note ?? undefined} dir="auto" />
          </FormField>
          <FormField name="hoursNoteAr" label={f.hoursNoteAr} optionalLabel={opt}>
            <Input name="hoursNoteAr" maxLength={300} defaultValue={initial?.hours_note_ar ?? undefined} dir="rtl" lang="ar" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        {section(labels.sections.access!)}
        <p className="text-xs text-muted-foreground">{labels.hints.access}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACCESS_KEYS.map((k) => (
            <FormField key={k} name={`access_${k}`} label={labels.access[k] ?? k}>
              <Select name={`access_${k}`} defaultValue={initial?.access[k] === true ? 'yes' : initial?.access[k] === false ? 'no' : ''}>
                <option value="">{labels.accessValues.unknown}</option>
                <option value="yes">{labels.accessValues.yes}</option>
                <option value="no">{labels.accessValues.no}</option>
              </Select>
            </FormField>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField name="accessibilityNote" label={f.accessibilityNote} optionalLabel={opt}>
            <Textarea name="accessibilityNote" rows={2} maxLength={500} defaultValue={initial?.accessibility_note ?? undefined} dir="auto" />
          </FormField>
          <FormField name="accessibilityNoteAr" label={f.accessibilityNoteAr} optionalLabel={opt}>
            <Textarea name="accessibilityNoteAr" rows={2} maxLength={500} defaultValue={initial?.accessibility_note_ar ?? undefined} dir="rtl" lang="ar" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        {section(labels.sections.contact!)}
        <div className="grid gap-4 md:grid-cols-3">
          <FormField name="phone" label={f.phone} optionalLabel={opt}>
            <Input name="phone" type="tel" maxLength={32} defaultValue={initial?.phone ?? undefined} dir="ltr" />
          </FormField>
          <FormField name="email" label={f.email} optionalLabel={opt}>
            <Input name="email" type="email" maxLength={254} defaultValue={initial?.email ?? undefined} dir="ltr" />
          </FormField>
          <FormField name="url" label={f.url} optionalLabel={opt}>
            <Input name="url" type="url" maxLength={500} defaultValue={initial?.url ?? undefined} dir="ltr" placeholder="https://" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        {section(labels.sections.search!)}
        <FormField name="aliases" label={f.aliases} hint={labels.hints.aliases} optionalLabel={opt}>
          <Textarea name="aliases" rows={3} defaultValue={initial?.aliases.join('\n')} dir="auto" />
        </FormField>
      </fieldset>

      <SubmitButton pendingLabel={labels.saving}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}
