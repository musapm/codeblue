'use client'

import { useState } from 'react'
import { FormField } from '@/components/management/form-field'
import { useFieldError } from '@/components/management/action-form'
import { Input, Select, Textarea } from '@/components/ui/input'

export type MetaLabels = {
  title: string
  titleAr: string
  description: string
  language: string
  languages: { en: string; ar: string; mixed: string }
  department: string
  noDepartment: string
  category: string
  categoryHint: string
  visibility: string
  visibilities: { public: string; members: string; staff: string; restricted: string }
  accessDepartments: string
  accessRoles: string
  authoritative: string
  priority: string
  effectiveDate: string
  expiryDate: string
  sourceUrl: string
  optional: string
}

export type MetaDefaults = {
  title?: string
  titleAr?: string | null
  description?: string | null
  language?: string
  departmentId?: string | null
  category?: string | null
  visibility?: string
  isAuthoritative?: boolean
  sourcePriority?: number
  effectiveDate?: string | null
  expiryDate?: string | null
  sourceUrl?: string | null
  accessDepartmentIds?: string[]
  accessRoleIds?: string[]
}

type Option = { id: string; label: string }

function CheckboxGroup({ name, legend, options, defaults }: { name: string; legend: string; options: Option[]; defaults: string[] }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={o.id} defaultChecked={defaults.includes(o.id)} className="size-4 rounded border-input accent-[var(--color-primary)]" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Document metadata fields shared by the upload form and the edit form. */
export function KnowledgeMetaFields({ defaults = {}, departments, roles, labels }: { defaults?: MetaDefaults; departments: Option[]; roles: Option[]; labels: MetaLabels }) {
  const [visibility, setVisibility] = useState(defaults.visibility ?? 'staff')
  const visibilityError = useFieldError('visibility')
  return (
    <div className="@container space-y-4">
      <div className="grid gap-4 @xl:grid-cols-2">
        <FormField name="title" label={labels.title}>
          <Input name="title" required minLength={2} maxLength={200} defaultValue={defaults.title} />
        </FormField>
        <FormField name="titleAr" label={labels.titleAr} optionalLabel={labels.optional}>
          <Input name="titleAr" maxLength={200} dir="rtl" lang="ar" defaultValue={defaults.titleAr ?? undefined} />
        </FormField>
      </div>
      <FormField name="description" label={labels.description} optionalLabel={labels.optional}>
        <Textarea name="description" maxLength={1000} rows={2} defaultValue={defaults.description ?? undefined} className="min-h-16" />
      </FormField>
      <div className="grid gap-4 @xl:grid-cols-3">
        <FormField name="language" label={labels.language}>
          <Select name="language" defaultValue={defaults.language ?? 'en'}>
            <option value="en">{labels.languages.en}</option>
            <option value="ar">{labels.languages.ar}</option>
            <option value="mixed">{labels.languages.mixed}</option>
          </Select>
        </FormField>
        <FormField name="departmentId" label={labels.department}>
          <Select name="departmentId" defaultValue={defaults.departmentId ?? ''}>
            <option value="">{labels.noDepartment}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField name="category" label={labels.category} hint={labels.categoryHint} optionalLabel={labels.optional}>
          <Input name="category" maxLength={60} defaultValue={defaults.category ?? undefined} />
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{labels.visibility}</legend>
        <div className="grid gap-1.5 @xl:grid-cols-2">
          {(['members', 'staff', 'restricted', 'public'] as const).map((v) => (
            <label key={v} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={visibility === v}
                onChange={() => setVisibility(v)}
                className="mt-0.5 size-4 accent-[var(--color-primary)]"
              />
              {labels.visibilities[v]}
            </label>
          ))}
        </div>
        {visibilityError ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {visibilityError}
          </p>
        ) : null}
      </fieldset>
      {visibility === 'restricted' ? (
        <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
          {departments.length ? <CheckboxGroup name="accessDepartmentIds" legend={labels.accessDepartments} options={departments} defaults={defaults.accessDepartmentIds ?? []} /> : null}
          <CheckboxGroup name="accessRoleIds" legend={labels.accessRoles} options={roles} defaults={defaults.accessRoleIds ?? []} />
        </div>
      ) : null}

      <div className="grid gap-4 @xl:grid-cols-3">
        <FormField name="effectiveDate" label={labels.effectiveDate} optionalLabel={labels.optional}>
          <Input name="effectiveDate" type="date" defaultValue={defaults.effectiveDate ?? undefined} />
        </FormField>
        <FormField name="expiryDate" label={labels.expiryDate} optionalLabel={labels.optional}>
          <Input name="expiryDate" type="date" defaultValue={defaults.expiryDate ?? undefined} />
        </FormField>
        <FormField name="sourcePriority" label={labels.priority}>
          <Input name="sourcePriority" type="number" min={0} max={100} defaultValue={defaults.sourcePriority ?? 50} />
        </FormField>
      </div>
      <FormField name="sourceUrl" label={labels.sourceUrl} optionalLabel={labels.optional}>
        <Input name="sourceUrl" type="url" maxLength={2000} dir="ltr" placeholder="https://" defaultValue={defaults.sourceUrl ?? undefined} />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isAuthoritative" defaultChecked={defaults.isAuthoritative} className="size-4 rounded border-input accent-[var(--color-primary)]" />
        {labels.authoritative}
      </label>
    </div>
  )
}

/** Same field names as readMetaForm() in the Server Action. */
export function metaFromForm(fd: FormData) {
  const s = (k: string) => {
    const v = fd.get(k)
    return typeof v === 'string' ? v : undefined
  }
  return {
    title: s('title') ?? '',
    titleAr: s('titleAr'),
    description: s('description'),
    language: s('language') as 'en' | 'ar' | 'mixed' | undefined,
    departmentId: s('departmentId'),
    category: s('category'),
    visibility: s('visibility') as 'public' | 'members' | 'staff' | 'restricted' | undefined,
    isAuthoritative: fd.get('isAuthoritative') === 'on',
    sourcePriority: s('sourcePriority'),
    effectiveDate: s('effectiveDate'),
    expiryDate: s('expiryDate'),
    sourceUrl: s('sourceUrl'),
    accessDepartmentIds: fd.getAll('accessDepartmentIds').map(String),
    accessRoleIds: fd.getAll('accessRoleIds').map(String),
  }
}
