'use client'

import { Sparkles } from 'lucide-react'
import { useActionState, useState, useTransition } from 'react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionForm, type FormMessages } from '@/components/management/action-form'
import { FormField } from '@/components/management/form-field'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { idleState, type ActionState } from '@/lib/management/action-state'
import {
  addTicketNote,
  createTicket,
  draftTicketFromConversation,
  replyToTicket,
  saveCategory,
  summarizeTicketAction,
  updateTicket,
} from '@/lib/tickets/actions'

/** Ticket forms. Only plain strings and records come from the server. */

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

export function NewRequestForm({
  tenant,
  locale,
  categories,
  conversationId,
  aiAvailable,
  labels,
  messages,
}: {
  tenant: string
  locale: string
  categories: Option[]
  /** Set when the request starts from an assistant conversation (handoff). */
  conversationId: string | null
  aiAvailable: boolean
  labels: Record<
    | 'category' | 'noCategory' | 'subject' | 'body' | 'bodyHint' | 'share' | 'shareHint' | 'draft' | 'drafting' | 'draftNote' | 'submit' | 'submitting',
    string
  >
  messages: FormMessages
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('')
  const [drafted, setDrafted] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [drafting, startDraft] = useTransition()

  function draft() {
    if (!conversationId) return
    setDraftError(null)
    startDraft(async () => {
      const result = await draftTicketFromConversation({ tenant, conversationId, locale })
      if (result.status === 'success' && result.data) {
        setSubject(result.data.subject)
        setBody(result.data.description)
        if (result.data.categoryId) setCategory(result.data.categoryId)
        setDrafted(true)
      } else if (result.status === 'error') {
        setDraftError(messages.errors[result.error])
      }
    })
  }

  return (
    <ActionForm action={createTicket} hidden={{ tenant, locale, conversationId: conversationId ?? undefined }} messages={messages}>
      {conversationId && aiAvailable ? (
        <div className="space-y-2">
          <Button type="button" variant="secondary" onClick={draft} disabled={drafting}>
            <Sparkles aria-hidden />
            {drafting ? labels.drafting : labels.draft}
          </Button>
          {drafted ? <p className="text-xs text-muted-foreground">{labels.draftNote}</p> : null}
          {draftError ? (
            <Alert variant="warning" role="alert">
              {draftError}
            </Alert>
          ) : null}
        </div>
      ) : null}
      <FormField name="categoryId" label={labels.category}>
        <Select name="categoryId" value={category} onChange={(e) => setCategory(e.target.value)}>
          <Options options={categories} empty={labels.noCategory} />
        </Select>
      </FormField>
      <FormField name="subject" label={labels.subject}>
        <Input name="subject" required minLength={3} maxLength={200} dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </FormField>
      <FormField name="body" label={labels.body} hint={labels.bodyHint}>
        <Textarea name="body" required rows={6} maxLength={8000} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} />
      </FormField>
      {conversationId ? (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="shareConversation" className="mt-1 size-4 shrink-0 accent-primary" />
          <span>
            {labels.share}
            <span className="block text-xs text-muted-foreground">{labels.shareHint}</span>
          </span>
        </label>
      ) : null}
      <SubmitButton pendingLabel={labels.submitting}>{labels.submit}</SubmitButton>
    </ActionForm>
  )
}

export function MessageForm({
  kind,
  hidden,
  labels,
  messages,
}: {
  kind: 'reply' | 'note'
  hidden: Hidden
  labels: { label: string; placeholder: string; submit: string; sending: string }
  messages: FormMessages
}) {
  return (
    <ActionForm action={kind === 'reply' ? replyToTicket : addTicketNote} hidden={hidden} messages={messages} resetOnSuccess showSuccess={false}>
      <FormField name="body" label={<span className="sr-only">{labels.label}</span>}>
        <Textarea name="body" required rows={3} maxLength={8000} placeholder={labels.placeholder} dir="auto" />
      </FormField>
      <SubmitButton size="sm" variant={kind === 'reply' ? 'primary' : 'secondary'} pendingLabel={labels.sending}>
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}

export function TicketUpdateForm({
  hidden,
  initial,
  options,
  labels,
  messages,
}: {
  hidden: Hidden
  initial: { status: string; priority: string; categoryId: string | null; departmentId: string | null; assigneeId: string | null }
  options: { statuses: Option[]; priorities: Option[]; categories: Option[]; departments: Option[]; assignees: Option[] }
  labels: Record<'status' | 'priority' | 'category' | 'noCategory' | 'department' | 'noDepartment' | 'assignee' | 'unassigned' | 'assignHint' | 'save' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={updateTicket} hidden={hidden} messages={messages}>
      <FormField name="status" label={labels.status}>
        <Select name="status" defaultValue={initial.status}>
          <Options options={options.statuses} />
        </Select>
      </FormField>
      <FormField name="priority" label={labels.priority}>
        <Select name="priority" defaultValue={initial.priority}>
          <Options options={options.priorities} />
        </Select>
      </FormField>
      <FormField name="categoryId" label={labels.category}>
        <Select name="categoryId" defaultValue={initial.categoryId ?? ''}>
          <Options options={options.categories} empty={labels.noCategory} />
        </Select>
      </FormField>
      <FormField name="departmentId" label={labels.department}>
        <Select name="departmentId" defaultValue={initial.departmentId ?? ''}>
          <Options options={options.departments} empty={labels.noDepartment} />
        </Select>
      </FormField>
      <FormField name="assigneeId" label={labels.assignee} hint={labels.assignHint}>
        <Select name="assigneeId" defaultValue={initial.assigneeId ?? ''}>
          <Options options={options.assignees} empty={labels.unassigned} />
        </Select>
      </FormField>
      <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
    </ActionForm>
  )
}

export function SummarizeButton({ hidden, labels, messages }: { hidden: Hidden; labels: { summarize: string; summarizing: string }; messages: FormMessages }) {
  const [state, action] = useActionState(summarizeTicketAction, idleState as ActionState)
  return (
    <form action={action} className="space-y-2">
      {Object.entries(hidden).map(([k, v]) => (v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
      <SubmitButton size="sm" variant="secondary" pendingLabel={labels.summarizing}>
        <Sparkles aria-hidden />
        {labels.summarize}
      </SubmitButton>
      {state.status === 'error' ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {messages.errors[state.error]}
        </p>
      ) : null}
    </form>
  )
}

export function CategoryForm({
  hidden,
  initial,
  options,
  labels,
  messages,
}: {
  hidden: Hidden
  initial?: { id: string; name: string; nameAr: string | null; departmentId: string | null; defaultPriority: string; sortOrder: number }
  options: { departments: Option[]; priorities: Option[] }
  labels: Record<'name' | 'nameAr' | 'department' | 'noDepartment' | 'priority' | 'sortOrder' | 'optional' | 'submit' | 'saving', string>
  messages: FormMessages
}) {
  return (
    <ActionForm action={saveCategory} hidden={{ ...hidden, categoryId: initial?.id }} messages={messages} resetOnSuccess={!initial}>
      <div className="@container">
        <div className="grid gap-4 @lg:grid-cols-2">
          <FormField name="name" label={labels.name}>
            <Input name="name" required minLength={2} maxLength={80} defaultValue={initial?.name} />
          </FormField>
          <FormField name="nameAr" label={labels.nameAr} optionalLabel={labels.optional}>
            <Input name="nameAr" maxLength={80} dir="rtl" lang="ar" defaultValue={initial?.nameAr ?? undefined} />
          </FormField>
          <FormField name="departmentId" label={labels.department}>
            <Select name="departmentId" defaultValue={initial?.departmentId ?? ''}>
              <Options options={options.departments} empty={labels.noDepartment} />
            </Select>
          </FormField>
          <FormField name="defaultPriority" label={labels.priority}>
            <Select name="defaultPriority" defaultValue={initial?.defaultPriority ?? 'normal'}>
              <Options options={options.priorities} />
            </Select>
          </FormField>
          <FormField name="sortOrder" label={labels.sortOrder} optionalLabel={labels.optional}>
            <Input name="sortOrder" type="number" step={1} min={-1000} max={1000} dir="ltr" className="max-w-32" defaultValue={initial?.sortOrder ?? 0} />
          </FormField>
        </div>
      </div>
      <SubmitButton size="sm" pendingLabel={labels.saving}>
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}
