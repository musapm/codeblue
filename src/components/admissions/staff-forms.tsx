'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Input, Select, Textarea } from '@/components/ui/input'
import {
  addLeadNote,
  createLead,
  saveProgram,
  updateAdmissionsAssistant,
  updateAdmissionsSettings,
  updateLead,
} from '@/lib/admissions/actions'

/** Staff admissions forms. Only plain strings and records come from the server. */

type Option = { value: string; label: string }
type Hidden = Record<string, string | undefined>

function Options({ options, empty }: { options: Option[]; empty?: string }) {
  return (
    <>
      {empty !== undefined ? <option value="">{empty}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  )
}

export type ProgramFormLabels = Record<
  | 'code' | 'codeHint' | 'name' | 'nameAr' | 'level' | 'department' | 'noDepartment' | 'description' | 'descriptionAr'
  | 'requirements' | 'requirementsAr' | 'requirementsHint' | 'duration' | 'studyMode' | 'language' | 'intakes' | 'intakesAr'
  | 'intakesHint' | 'tuitionAmount' | 'tuitionCurrency' | 'tuitionCurrencyHint' | 'tuitionPeriod' | 'tuitionNote'
  | 'tuitionNoteAr' | 'deadline' | 'applicationUrl' | 'sortOrder' | 'notSpecified' | 'optional' | 'submit' | 'saving',
  string
>

export type ProgramValues = {
  id: string
  code: string
  name: string
  name_ar: string | null
  level: string
  department_id: string | null
  description: string | null
  description_ar: string | null
  requirements: string | null
  requirements_ar: string | null
  duration_months: number | null
  study_mode: string | null
  teaching_language: string | null
  intakes: string | null
  intakes_ar: string | null
  tuition_amount: number | null
  tuition_currency: string | null
  tuition_period: string | null
  tuition_note: string | null
  tuition_note_ar: string | null
  application_deadline: string | null
  application_url: string | null
  sort_order: number
}

export function ProgramForm({
  hidden,
  initial,
  options,
  labels,
  messages,
}: {
  hidden: Hidden
  initial?: ProgramValues
  options: { levels: Option[]; departments: Option[]; modes: Option[]; languages: Option[]; periods: Option[] }
  labels: ProgramFormLabels
  messages: FormMessages
}) {
  const v = (x: string | number | null | undefined) => (x === null || x === undefined ? undefined : String(x))
  return (
    <ActionForm action={saveProgram} hidden={{ ...hidden, programId: initial?.id }} messages={messages}>
      <div className="@container">
        <div className="grid gap-4 @lg:grid-cols-2">
          <FormField name="code" label={labels.code} hint={labels.codeHint}>
            <Input name="code" required maxLength={32} dir="ltr" defaultValue={initial?.code} />
          </FormField>
          <FormField name="level" label={labels.level}>
            <Select name="level" defaultValue={initial?.level ?? 'bachelor'}>
              <Options options={options.levels} />
            </Select>
          </FormField>
          <FormField name="name" label={labels.name}>
            <Input name="name" required minLength={2} maxLength={160} defaultValue={initial?.name} />
          </FormField>
          <FormField name="nameAr" label={labels.nameAr} optionalLabel={labels.optional}>
            <Input name="nameAr" maxLength={160} dir="rtl" lang="ar" defaultValue={v(initial?.name_ar)} />
          </FormField>
          <FormField name="departmentId" label={labels.department} optionalLabel={labels.optional}>
            <Select name="departmentId" defaultValue={initial?.department_id ?? ''}>
              <Options options={options.departments} empty={labels.noDepartment} />
            </Select>
          </FormField>
          <FormField name="durationMonths" label={labels.duration} optionalLabel={labels.optional}>
            <Input name="durationMonths" type="number" min={1} max={120} step={1} dir="ltr" defaultValue={v(initial?.duration_months)} />
          </FormField>
          <FormField name="studyMode" label={labels.studyMode} optionalLabel={labels.optional}>
            <Select name="studyMode" defaultValue={initial?.study_mode ?? ''}>
              <Options options={options.modes} empty={labels.notSpecified} />
            </Select>
          </FormField>
          <FormField name="teachingLanguage" label={labels.language} optionalLabel={labels.optional}>
            <Select name="teachingLanguage" defaultValue={initial?.teaching_language ?? ''}>
              <Options options={options.languages} empty={labels.notSpecified} />
            </Select>
          </FormField>
          <FormField name="intakes" label={labels.intakes} hint={labels.intakesHint} optionalLabel={labels.optional}>
            <Input name="intakes" maxLength={200} defaultValue={v(initial?.intakes)} />
          </FormField>
          <FormField name="intakesAr" label={labels.intakesAr} optionalLabel={labels.optional}>
            <Input name="intakesAr" maxLength={200} dir="rtl" lang="ar" defaultValue={v(initial?.intakes_ar)} />
          </FormField>
          <FormField name="tuitionAmount" label={labels.tuitionAmount} optionalLabel={labels.optional}>
            <Input name="tuitionAmount" type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" defaultValue={v(initial?.tuition_amount)} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField name="tuitionCurrency" label={labels.tuitionCurrency} hint={labels.tuitionCurrencyHint}>
              <Input name="tuitionCurrency" maxLength={3} dir="ltr" className="uppercase" defaultValue={v(initial?.tuition_currency)} />
            </FormField>
            <FormField name="tuitionPeriod" label={labels.tuitionPeriod}>
              <Select name="tuitionPeriod" defaultValue={initial?.tuition_period ?? ''}>
                <Options options={options.periods} empty={labels.notSpecified} />
              </Select>
            </FormField>
          </div>
          <FormField name="tuitionNote" label={labels.tuitionNote} optionalLabel={labels.optional}>
            <Input name="tuitionNote" maxLength={500} defaultValue={v(initial?.tuition_note)} />
          </FormField>
          <FormField name="tuitionNoteAr" label={labels.tuitionNoteAr} optionalLabel={labels.optional}>
            <Input name="tuitionNoteAr" maxLength={500} dir="rtl" lang="ar" defaultValue={v(initial?.tuition_note_ar)} />
          </FormField>
          <FormField name="applicationDeadline" label={labels.deadline} optionalLabel={labels.optional}>
            <Input name="applicationDeadline" type="date" dir="ltr" defaultValue={v(initial?.application_deadline)} />
          </FormField>
          <FormField name="applicationUrl" label={labels.applicationUrl} optionalLabel={labels.optional}>
            <Input name="applicationUrl" type="url" maxLength={500} dir="ltr" placeholder="https://" defaultValue={v(initial?.application_url)} />
          </FormField>
          <FormField name="description" label={labels.description} optionalLabel={labels.optional} className="@lg:col-span-2">
            <Textarea name="description" rows={4} maxLength={4000} defaultValue={v(initial?.description)} />
          </FormField>
          <FormField name="descriptionAr" label={labels.descriptionAr} optionalLabel={labels.optional} className="@lg:col-span-2">
            <Textarea name="descriptionAr" rows={4} maxLength={4000} dir="rtl" lang="ar" defaultValue={v(initial?.description_ar)} />
          </FormField>
          <FormField name="requirements" label={labels.requirements} hint={labels.requirementsHint} optionalLabel={labels.optional}>
            <Textarea name="requirements" rows={5} maxLength={4000} defaultValue={v(initial?.requirements)} />
          </FormField>
          <FormField name="requirementsAr" label={labels.requirementsAr} optionalLabel={labels.optional}>
            <Textarea name="requirementsAr" rows={5} maxLength={4000} dir="rtl" lang="ar" defaultValue={v(initial?.requirements_ar)} />
          </FormField>
          <FormField name="sortOrder" label={labels.sortOrder} optionalLabel={labels.optional}>
            <Input name="sortOrder" type="number" min={-1000} max={1000} step={1} dir="ltr" className="max-w-32" defaultValue={v(initial?.sort_order)} />
          </FormField>
        </div>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}

export function LeadUpdateForm({
  hidden,
  initial,
  options,
  labels,
  messages,
}: {
  hidden: Hidden
  initial: { stage: string; lostReason: string | null; assignedTo: string | null; programId: string | null }
  options: { stages: Option[]; assignees: Option[]; programs: Option[] }
  labels: Record<'stage' | 'lostReason' | 'assignedTo' | 'unassigned' | 'program' | 'noProgram' | 'optional' | 'save' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateLead} hidden={hidden} messages={messages}>
      <FormField name="stage" label={labels.stage}>
        <Select name="stage" defaultValue={initial.stage}>
          <Options options={options.stages} />
        </Select>
      </FormField>
      <FormField name="lostReason" label={labels.lostReason} optionalLabel={labels.optional}>
        <Input name="lostReason" maxLength={300} defaultValue={initial.lostReason ?? undefined} />
      </FormField>
      <FormField name="assignedTo" label={labels.assignedTo}>
        <Select name="assignedTo" defaultValue={initial.assignedTo ?? ''}>
          <Options options={options.assignees} empty={labels.unassigned} />
        </Select>
      </FormField>
      <FormField name="programId" label={labels.program}>
        <Select name="programId" defaultValue={initial.programId ?? ''}>
          <Options options={options.programs} empty={labels.noProgram} />
        </Select>
      </FormField>
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}

export function LeadNoteForm({ hidden, labels, messages }: { hidden: Hidden; labels: { placeholder: string; submit: string; saving: string }; messages: FormMessages }) {
  return (
    <ActionForm action={addLeadNote} hidden={hidden} messages={messages} resetOnSuccess showSuccess={false}>
      <FormField name="body" label={<span className="sr-only">{labels.submit}</span>}>
        <Textarea name="body" rows={3} maxLength={4000} required placeholder={labels.placeholder} dir="auto" />
      </FormField>
      <SubmitButton variant="secondary" size="sm" pendingLabel={labels.saving}>
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}

export function ManualLeadForm({
  hidden,
  options,
  labels,
  messages,
}: {
  hidden: Hidden
  options: { programs: Option[]; locales: Option[] }
  labels: Record<
    'fullName' | 'email' | 'phone' | 'country' | 'program' | 'noProgram' | 'intake' | 'intakeHint' | 'message' | 'locale' | 'consentNote' | 'consentNoteHint' | 'optional' | 'submit' | 'saving',
    string
  >
  messages: FormMessages
}) {
  return (
    <ActionForm action={createLead} hidden={hidden} messages={messages}>
      <div className="@container">
        <div className="grid gap-4 @md:grid-cols-2">
          <FormField name="fullName" label={labels.fullName}>
            <Input name="fullName" required minLength={2} maxLength={120} dir="auto" />
          </FormField>
          <FormField name="locale" label={labels.locale}>
            <Select name="locale" defaultValue={hidden.locale ?? 'en'}>
              <Options options={options.locales} />
            </Select>
          </FormField>
          <FormField name="email" label={labels.email} optionalLabel={labels.optional}>
            <Input name="email" type="email" maxLength={254} dir="ltr" />
          </FormField>
          <FormField name="phone" label={labels.phone} optionalLabel={labels.optional}>
            <Input name="phone" type="tel" maxLength={32} dir="ltr" />
          </FormField>
          <FormField name="programId" label={labels.program} optionalLabel={labels.optional}>
            <Select name="programId" defaultValue="">
              <Options options={options.programs} empty={labels.noProgram} />
            </Select>
          </FormField>
          <FormField name="intake" label={labels.intake} hint={labels.intakeHint} optionalLabel={labels.optional}>
            <Input name="intake" maxLength={60} dir="auto" />
          </FormField>
          <FormField name="country" label={labels.country} optionalLabel={labels.optional}>
            <Input name="country" maxLength={80} dir="auto" />
          </FormField>
          <FormField name="message" label={labels.message} optionalLabel={labels.optional} className="@md:col-span-2">
            <Textarea name="message" rows={3} maxLength={2000} dir="auto" />
          </FormField>
          <FormField name="consentNote" label={labels.consentNote} hint={labels.consentNoteHint} className="@md:col-span-2">
            <Input name="consentNote" required minLength={10} maxLength={2000} dir="auto" />
          </FormField>
        </div>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}

export function AdmissionsSettingsForm({
  hidden,
  initial,
  labels,
  messages,
}: {
  hidden: Hidden
  initial: { publicEnabled: boolean; contactEmail: string | null; privacyUrl: string | null; welcome: string | null; welcomeAr: string | null; consentText: string | null; consentTextAr: string | null }
  labels: Record<
    'publicEnabled' | 'contactEmail' | 'contactEmailHint' | 'privacyUrl' | 'privacyUrlHint' | 'welcome' | 'welcomeAr' | 'consent' | 'consentAr' | 'consentHint' | 'optional' | 'save' | 'saving',
    string
  >
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateAdmissionsSettings} hidden={hidden} messages={messages}>
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" name="publicEnabled" defaultChecked={initial.publicEnabled} className="size-4 accent-primary" />
        {labels.publicEnabled}
      </label>
      <div className="@container">
        <div className="grid gap-4 @lg:grid-cols-2">
          <FormField name="contactEmail" label={labels.contactEmail} hint={labels.contactEmailHint} optionalLabel={labels.optional}>
            <Input name="contactEmail" type="email" maxLength={254} dir="ltr" defaultValue={initial.contactEmail ?? undefined} />
          </FormField>
          <FormField name="privacyUrl" label={labels.privacyUrl} hint={labels.privacyUrlHint} optionalLabel={labels.optional}>
            <Input name="privacyUrl" type="url" maxLength={500} dir="ltr" placeholder="https://" defaultValue={initial.privacyUrl ?? undefined} />
          </FormField>
          <FormField name="welcome" label={labels.welcome} optionalLabel={labels.optional}>
            <Textarea name="welcome" rows={2} maxLength={500} defaultValue={initial.welcome ?? undefined} />
          </FormField>
          <FormField name="welcomeAr" label={labels.welcomeAr} optionalLabel={labels.optional}>
            <Textarea name="welcomeAr" rows={2} maxLength={500} dir="rtl" lang="ar" defaultValue={initial.welcomeAr ?? undefined} />
          </FormField>
          <FormField name="consentText" label={labels.consent} hint={labels.consentHint} optionalLabel={labels.optional}>
            <Textarea name="consentText" rows={3} maxLength={1000} defaultValue={initial.consentText ?? undefined} />
          </FormField>
          <FormField name="consentTextAr" label={labels.consentAr} optionalLabel={labels.optional}>
            <Textarea name="consentTextAr" rows={3} maxLength={1000} dir="rtl" lang="ar" defaultValue={initial.consentTextAr ?? undefined} />
          </FormField>
        </div>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}

export function AdmissionsAssistantForm({
  hidden,
  initial,
  labels,
  messages,
}: {
  hidden: Hidden
  initial: { enabled: boolean; instructions: string | null; monthlyBudgetUsd: number; dailyQuestions: number }
  labels: Record<'enabled' | 'instructions' | 'instructionsHint' | 'budget' | 'budgetHint' | 'daily' | 'dailyHint' | 'optional' | 'save' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateAdmissionsAssistant} hidden={hidden} messages={messages}>
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" name="assistantEnabled" defaultChecked={initial.enabled} className="size-4 accent-primary" />
        {labels.enabled}
      </label>
      <FormField name="instructions" label={labels.instructions} hint={labels.instructionsHint} optionalLabel={labels.optional}>
        <Textarea name="instructions" rows={4} maxLength={2000} dir="auto" defaultValue={initial.instructions ?? undefined} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="monthlyBudgetUsd" label={labels.budget} hint={labels.budgetHint}>
          <Input name="monthlyBudgetUsd" type="number" min={0} max={100000} step="0.01" inputMode="decimal" dir="ltr" defaultValue={initial.monthlyBudgetUsd} />
        </FormField>
        <FormField name="dailyQuestions" label={labels.daily} hint={labels.dailyHint}>
          <Input name="dailyQuestions" type="number" min={1} max={200} step={1} dir="ltr" defaultValue={initial.dailyQuestions} />
        </FormField>
      </div>
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}
