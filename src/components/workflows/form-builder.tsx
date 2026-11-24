'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, useFieldError, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { saveDraftAction } from '@/lib/workflows/actions'
import { FIELD_TYPES, keyFromLabel, optionLines, parseOptionLines, type FieldType, type FormField as Field } from '@/lib/workflows/schemas'

/**
 * The form builder: fields with English and Arabic labels, a type, required or not, and choices.
 * Keys are made once from the English label and then kept, so answers stay comparable across
 * versions. Saving writes the draft version; publishing is a separate step.
 */

type Row = Field & { uid: string; isNew: boolean; optionsText: string }

export type BuilderLabels = Record<
  | 'fields'
  | 'addField'
  | 'fieldLabel'
  | 'fieldLabelAr'
  | 'fieldHelp'
  | 'fieldHelpAr'
  | 'fieldType'
  | 'fieldRequired'
  | 'fieldOptions'
  | 'fieldOptionsHint'
  | 'moveUp'
  | 'moveDown'
  | 'removeField'
  | 'instructions'
  | 'instructionsAr'
  | 'confirmation'
  | 'confirmationHint'
  | 'confirmationAr'
  | 'saveDraft'
  | 'saving'
  | 'optional',
  string
> & { field: string; types: Record<string, string> }

let counter = 0
const uid = () => `f${++counter}`

const toRows = (fields: Field[]): Row[] => fields.map((f) => ({ ...f, uid: uid(), isNew: false, optionsText: optionLines(f.options) }))

/** The stored shape: empty optional texts removed, options only for choices. */
function toFields(rows: Row[]): Field[] {
  return rows.map((r) => {
    const out: Field = { key: r.key, type: r.type, label: r.label.trim(), required: r.required }
    if (r.label_ar?.trim()) out.label_ar = r.label_ar.trim()
    if (r.help?.trim()) out.help = r.help.trim()
    if (r.help_ar?.trim()) out.help_ar = r.help_ar.trim()
    if (r.type === 'select') out.options = parseOptionLines(r.optionsText, r.options ?? [])
    return out
  })
}

export function VersionEditor({
  definitionId,
  initialFields,
  initialTexts,
  labels,
  messages,
}: {
  definitionId: string
  initialFields: Field[]
  initialTexts: { instructions: string | null; instructionsAr: string | null; confirmation: string | null; confirmationAr: string | null }
  labels: BuilderLabels
  messages: FormMessages
}) {
  const [rows, setRows] = useState<Row[]>(() => (initialFields.length ? toRows(initialFields) : [{ key: 'field', type: 'text', label: '', required: true, uid: uid(), isNew: true, optionsText: '' }]))

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((r, i) => {
        if (i !== index) return r
        const next = { ...r, ...patch }
        if (next.isNew && patch.label !== undefined) {
          const taken = new Set(current.filter((_, j) => j !== i).map((x) => x.key))
          next.key = keyFromLabel(patch.label, taken)
        }
        return next
      }),
    )
  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const next = [...current]
      const [row] = next.splice(index, 1)
      next.splice(index + by, 0, row!)
      return next
    })
  const add = () =>
    setRows((current) => {
      const taken = new Set(current.map((r) => r.key))
      return [...current, { key: keyFromLabel('', taken), type: 'text', label: '', required: false, uid: uid(), isNew: true, optionsText: '' }]
    })

  return (
    <ActionForm action={saveDraftAction} hidden={{ definitionId, fields: JSON.stringify(toFields(rows)) }} messages={messages}>
      <FieldsError />
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{labels.fields}</legend>
        {rows.map((row, i) => (
          <FieldRow
            key={row.uid}
            row={row}
            index={i}
            last={i === rows.length - 1}
            labels={labels}
            onChange={(patch) => update(i, patch)}
            onMove={(by) => move(i, by)}
            onRemove={rows.length > 1 ? () => setRows((current) => current.filter((_, j) => j !== i)) : undefined}
          />
        ))}
        {rows.length < 30 ? (
          <Button type="button" variant="secondary" size="sm" onClick={add}>
            <Plus aria-hidden />
            {labels.addField}
          </Button>
        ) : null}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField name="instructions" label={labels.instructions} optionalLabel={labels.optional}>
          <Textarea name="instructions" rows={3} maxLength={2000} defaultValue={initialTexts.instructions ?? undefined} dir="auto" />
        </FormField>
        <FormField name="instructionsAr" label={labels.instructionsAr} optionalLabel={labels.optional}>
          <Textarea name="instructionsAr" rows={3} maxLength={2000} defaultValue={initialTexts.instructionsAr ?? undefined} dir="rtl" lang="ar" />
        </FormField>
        <FormField name="confirmation" label={labels.confirmation} hint={labels.confirmationHint} optionalLabel={labels.optional}>
          <Textarea name="confirmation" rows={2} maxLength={1000} defaultValue={initialTexts.confirmation ?? undefined} dir="auto" />
        </FormField>
        <FormField name="confirmationAr" label={labels.confirmationAr} optionalLabel={labels.optional}>
          <Textarea name="confirmationAr" rows={2} maxLength={1000} defaultValue={initialTexts.confirmationAr ?? undefined} dir="rtl" lang="ar" />
        </FormField>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.saveDraft}</SubmitButton>
    </ActionForm>
  )
}

function FieldsError() {
  const error = useFieldError('fields')
  return error ? (
    <Alert variant="danger" role="alert">
      {error}
    </Alert>
  ) : null
}

function FieldRow({
  row,
  index,
  last,
  labels,
  onChange,
  onMove,
  onRemove,
}: {
  row: Row
  index: number
  last: boolean
  labels: BuilderLabels
  onChange: (patch: Partial<Row>) => void
  onMove: (by: -1 | 1) => void
  onRemove?: () => void
}) {
  const id = useId()
  const title = labels.field.replace('{n}', String(index + 1))
  return (
    <div className="space-y-3 rounded-lg border border-border p-3" role="group" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center gap-2">
        <p id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </p>
        <code className="text-xs text-muted-foreground" dir="ltr">
          {row.key}
        </code>
        <span className="ms-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`${labels.moveUp}: ${title}`}>
            <ArrowUp aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => onMove(1)} disabled={last} aria-label={`${labels.moveDown}: ${title}`}>
            <ArrowDown aria-hidden />
          </Button>
          {onRemove ? (
            <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`${labels.removeField}: ${title}`}>
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Labelled id={`${id}-label`} label={labels.fieldLabel}>
          <Input id={`${id}-label`} value={row.label} onChange={(e) => onChange({ label: e.target.value })} maxLength={200} dir="auto" required />
        </Labelled>
        <Labelled id={`${id}-label-ar`} label={labels.fieldLabelAr} optional={labels.optional}>
          <Input id={`${id}-label-ar`} value={row.label_ar ?? ''} onChange={(e) => onChange({ label_ar: e.target.value })} maxLength={200} dir="rtl" lang="ar" />
        </Labelled>
        <Labelled id={`${id}-help`} label={labels.fieldHelp} optional={labels.optional}>
          <Input id={`${id}-help`} value={row.help ?? ''} onChange={(e) => onChange({ help: e.target.value })} maxLength={500} dir="auto" />
        </Labelled>
        <Labelled id={`${id}-help-ar`} label={labels.fieldHelpAr} optional={labels.optional}>
          <Input id={`${id}-help-ar`} value={row.help_ar ?? ''} onChange={(e) => onChange({ help_ar: e.target.value })} maxLength={500} dir="rtl" lang="ar" />
        </Labelled>
        <Labelled id={`${id}-type`} label={labels.fieldType}>
          <Select id={`${id}-type`} value={row.type} onChange={(e) => onChange({ type: e.target.value as FieldType })}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {labels.types[t] ?? t}
              </option>
            ))}
          </Select>
        </Labelled>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input type="checkbox" checked={row.required} onChange={(e) => onChange({ required: e.target.checked })} className="size-4 accent-primary" />
          {labels.fieldRequired}
        </label>
        {row.type === 'select' ? (
          <div className="md:col-span-2">
            <Labelled id={`${id}-options`} label={labels.fieldOptions} hint={labels.fieldOptionsHint}>
              <Textarea id={`${id}-options`} value={row.optionsText} onChange={(e) => onChange({ optionsText: e.target.value })} rows={4} dir="auto" />
            </Labelled>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Labelled({ id, label, hint, optional, children }: { id: string; label: string; hint?: string; optional?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium">
        <span>{label}</span>
        {optional ? <span className="text-xs font-normal text-muted-foreground">{optional}</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
