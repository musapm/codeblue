'use client'

import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { addInstructor, createCourse, joinCourse, updateAcademicSettings, updateCourse, updateCourseAi } from '@/lib/academic/actions'

/** Academic assistant forms. Only plain strings and records come from the server. */

type Option = { value: string; label: string }

export function CourseForm({
  tenant,
  locale,
  initial,
  departments,
  statuses,
  labels,
  messages,
}: {
  tenant: string
  locale: string
  /** Editing an existing course (with its status); creating otherwise. */
  initial?: { id: string; code: string; title: string; titleAr: string | null; description: string | null; term: string | null; departmentId: string | null; status: string }
  departments: Option[]
  statuses?: Option[]
  labels: Record<'code' | 'titleEn' | 'titleAr' | 'description' | 'term' | 'department' | 'noDepartment' | 'status' | 'statusHint' | 'optional' | 'submit' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={initial ? updateCourse : createCourse} hidden={{ tenant, locale, courseId: initial?.id }} messages={messages}>
      <div className="@container">
        <div className="grid gap-4 @lg:grid-cols-2">
          <FormField name="code" label={labels.code}>
            <Input name="code" required maxLength={20} dir="ltr" defaultValue={initial?.code} />
          </FormField>
          <FormField name="term" label={labels.term} optionalLabel={labels.optional}>
            <Input name="term" maxLength={40} defaultValue={initial?.term ?? undefined} />
          </FormField>
          <FormField name="title" label={labels.titleEn}>
            <Input name="title" required minLength={2} maxLength={160} dir="auto" defaultValue={initial?.title} />
          </FormField>
          <FormField name="titleAr" label={labels.titleAr} optionalLabel={labels.optional}>
            <Input name="titleAr" maxLength={160} dir="rtl" lang="ar" defaultValue={initial?.titleAr ?? undefined} />
          </FormField>
          <FormField name="departmentId" label={labels.department} optionalLabel={labels.optional}>
            <Select name="departmentId" defaultValue={initial?.departmentId ?? ''}>
              <option value="">{labels.noDepartment}</option>
              {departments.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </FormField>
          {initial && statuses ? (
            <FormField name="status" label={labels.status} hint={labels.statusHint}>
              <Select name="status" defaultValue={initial.status}>
                {statuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
        </div>
      </div>
      <FormField name="description" label={labels.description} optionalLabel={labels.optional}>
        <Textarea name="description" rows={3} maxLength={2000} dir="auto" defaultValue={initial?.description ?? undefined} />
      </FormField>
      <SubmitButton size="sm" pendingLabel={labels.saving}>
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}

export function CourseToolsForm({
  courseId,
  initial,
  kinds,
  labels,
  messages,
}: {
  courseId: string
  initial: { aiEnabled: boolean; allowSummaries: boolean; allowQuizzes: boolean; allowFlashcards: boolean; allowStudyPlans: boolean; instructions: string | null }
  kinds: Record<'summary' | 'quiz' | 'flashcards' | 'study_plan', string>
  labels: Record<'enabled' | 'allowed' | 'instructions' | 'instructionsHint' | 'optional' | 'submit' | 'saving', string>
  messages: FormMessages
}) {
  const box = 'size-4 shrink-0 accent-primary'
  return (
    <ActionForm action={updateCourseAi} hidden={{ courseId }} messages={messages}>
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" name="aiEnabled" defaultChecked={initial.aiEnabled} className={box} />
        {labels.enabled}
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{labels.allowed}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['allowSummaries', kinds.summary, initial.allowSummaries],
              ['allowQuizzes', kinds.quiz, initial.allowQuizzes],
              ['allowFlashcards', kinds.flashcards, initial.allowFlashcards],
              ['allowStudyPlans', kinds.study_plan, initial.allowStudyPlans],
            ] as const
          ).map(([name, label, checked]) => (
            <label key={name} className="flex items-center gap-3 text-sm">
              <input type="checkbox" name={name} defaultChecked={checked} className={box} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField name="instructions" label={labels.instructions} hint={labels.instructionsHint} optionalLabel={labels.optional}>
        <Textarea name="instructions" rows={3} maxLength={1000} dir="auto" defaultValue={initial.instructions ?? undefined} />
      </FormField>
      <SubmitButton size="sm" pendingLabel={labels.saving}>
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}

export function JoinForm({ tenant, locale, labels, messages }: { tenant: string; locale: string; labels: Record<'code' | 'hint' | 'submit' | 'joining', string>; messages: FormMessages }) {
  return (
    <ActionForm action={joinCourse} hidden={{ tenant, locale }} messages={messages} showSuccess={false}>
      <div className="flex flex-wrap items-end gap-3">
        <FormField name="code" label={labels.code} hint={labels.hint} className="min-w-48 flex-1">
          <Input name="code" required minLength={6} maxLength={20} autoComplete="off" spellCheck={false} dir="ltr" className="font-mono uppercase tracking-widest" />
        </FormField>
        <SubmitButton pendingLabel={labels.joining}>{labels.submit}</SubmitButton>
      </div>
    </ActionForm>
  )
}

export function InstructorForm({ courseId, labels, messages }: { courseId: string; labels: Record<'email' | 'hint' | 'submit' | 'saving', string>; messages: FormMessages }) {
  return (
    <ActionForm action={addInstructor} hidden={{ courseId }} messages={messages} resetOnSuccess>
      <div className="flex flex-wrap items-end gap-3">
        <FormField name="email" label={labels.email} hint={labels.hint} className="min-w-56 flex-1">
          <Input name="email" type="email" required autoComplete="off" dir="ltr" />
        </FormField>
        <SubmitButton size="sm" pendingLabel={labels.saving}>
          {labels.submit}
        </SubmitButton>
      </div>
    </ActionForm>
  )
}

export function AcademicSettingsForm({
  tenant,
  initial,
  labels,
  messages,
}: {
  tenant: string
  initial: { monthlyBudget: number; dailyLimit: number }
  labels: Record<'budget' | 'dailyLimit' | 'submit' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateAcademicSettings} hidden={{ tenant }} messages={messages}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="monthlyBudget" label={labels.budget}>
          <Input name="monthlyBudget" type="number" min={0} max={100000} step="0.01" dir="ltr" defaultValue={initial.monthlyBudget} />
        </FormField>
        <FormField name="dailyLimit" label={labels.dailyLimit}>
          <Input name="dailyLimit" type="number" min={1} max={200} step={1} dir="ltr" defaultValue={initial.dailyLimit} />
        </FormField>
      </div>
      <SubmitButton size="sm" pendingLabel={labels.saving}>
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}
