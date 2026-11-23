import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import { LeadNoteForm, LeadUpdateForm } from '@/components/admissions/staff-forms'
import { ActionButton } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonClasses } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteLead } from '@/lib/admissions/actions'
import { getLead, listAssignees, listPrograms } from '@/lib/admissions/queries'
import { admissionsOptions, personName, programName, STAGE_VARIANT } from '@/lib/admissions/view'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { getWorkspaceContext, hasWorkspacePermission } from '@/lib/tenancy/context'

export default async function LeadPage({ params }: PageProps<'/[lang]/app/[tenant]/admissions/leads/[leadId]'>) {
  const { tenant: slug, leadId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  if (!ctx.tenantId) notFound()
  const a = dict.admissions
  const { canWrite } = writeMode(ctx, dict)
  const canManage = canWrite && hasWorkspacePermission(ctx, 'leads.manage')

  const [found, programs, assignees] = await Promise.all([getLead(ctx.tenantId, leadId), listPrograms(ctx.tenantId), listAssignees(slug)])
  if (!found) notFound()
  const { lead, notes, events } = found
  const people = new Map(assignees.map((p) => [p.user_id, p]))
  const program = programs.find((p) => p.id === lead.program_id)
  const options = admissionsOptions(dict)
  const messages = formMessages(dict)
  const name = (id: string | null) => (id ? personName(people.get(id), a.lead.someone) : '—')

  const eventText = (e: (typeof events)[number]) => {
    switch (e.kind) {
      case 'created':
        return a.lead.events.created(a.sources[e.to_value ?? ''] ?? e.to_value ?? '')
      case 'stage':
        return a.lead.events.stage(a.stages[e.from_value ?? ''] ?? '—', a.stages[e.to_value ?? ''] ?? '—')
      case 'assigned':
        return e.to_value ? a.lead.events.assigned(name(e.to_value)) : a.lead.events.unassigned
      case 'program':
        return a.lead.events.program
      default:
        return a.lead.events.note
    }
  }

  const contact = [
    { label: a.fields.email, value: lead.email, ltr: true },
    { label: a.fields.phone, value: lead.phone, ltr: true },
    { label: a.fields.country, value: lead.country },
    { label: a.fields.locale, value: a.languages[lead.locale] ?? lead.locale },
  ]
  const details = [
    { label: a.fields.program, value: program ? programName(locale, program) : null },
    { label: a.fields.intake, value: lead.intake },
    { label: a.lead.source, value: a.sources[lead.source] ?? lead.source },
    { label: a.lead.received, value: formatDate(locale, lead.created_at, true) },
  ]

  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, `/app/${slug}/admissions`)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {a.lead.back}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold" dir="auto">
          {lead.full_name}
        </h2>
        <span className="font-mono text-sm text-muted-foreground" dir="ltr">
          {lead.reference}
        </span>
        <Badge variant={STAGE_VARIANT[lead.stage] ?? 'neutral'}>{a.stages[lead.stage] ?? lead.stage}</Badge>
      </div>
      {!canManage ? <Alert variant="info">{a.lead.readOnly}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{a.lead.contact}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {contact.map((r) => (
                    <div key={r.label} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="text-end font-medium break-all" dir={r.ltr ? 'ltr' : 'auto'}>
                        {r.value || '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{a.lead.details}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {details.map((r) => (
                    <div key={r.label} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="text-end font-medium">{r.value || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>

          {lead.message ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{a.fields.message}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line" dir="auto">
                  {lead.message}
                </p>
                {lead.source === 'assistant' ? <p className="mt-3 text-xs text-muted-foreground">{a.lead.fromAssistant}</p> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{a.lead.notes}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canManage ? (
                <LeadNoteForm hidden={{ leadId: lead.id }} messages={messages} labels={{ placeholder: a.lead.notePlaceholder, submit: a.lead.addNote, saving: dict.management.saving }} />
              ) : null}
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{a.lead.noNotes}</p>
              ) : (
                <ul className="space-y-3">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-border p-3">
                      <p className="text-sm whitespace-pre-line" dir="auto">
                        {n.body}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {name(n.author_id)} · {formatDate(locale, n.created_at, true)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{a.lead.consent}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{a.lead.consentAt}</dt>
                  <dd className="font-medium">{formatDate(locale, lead.consent_at, true)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{a.lead.consentVersion}</dt>
                  <dd className="font-mono text-xs" dir="ltr">
                    {lead.consent_version}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs font-medium text-muted-foreground">{a.lead.consentText}</p>
              <blockquote className="mt-1 border-s-2 border-border ps-3 text-sm" dir="auto">
                {lead.consent_text}
              </blockquote>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{a.lead.pipeline}</CardTitle>
              </CardHeader>
              <CardContent>
                <LeadUpdateForm
                  hidden={{ leadId: lead.id }}
                  initial={{ stage: lead.stage, lostReason: lead.lost_reason, assignedTo: lead.assigned_to, programId: lead.program_id }}
                  options={{
                    stages: options.stages,
                    assignees: assignees.map((p) => ({ value: p.user_id, label: personName(p, a.lead.someone) })),
                    programs: programs.map((p) => ({ value: p.id, label: programName(locale, p) })),
                  }}
                  messages={messages}
                  labels={{
                    stage: a.lead.stage,
                    lostReason: a.lead.lostReason,
                    assignedTo: a.lead.assignedTo,
                    unassigned: a.lead.unassigned,
                    program: a.fields.program,
                    noProgram: a.fields.noProgram,
                    optional: dict.common.optional,
                    save: a.lead.save,
                    saving: dict.management.saving,
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm">
                <p>
                  <span className="text-muted-foreground">{a.lead.assignedTo}: </span>
                  {name(lead.assigned_to)}
                </p>
                {lead.lost_reason ? (
                  <p className="mt-2">
                    <span className="text-muted-foreground">{a.lead.lostReason}: </span>
                    {lead.lost_reason}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{a.lead.history}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 border-s border-border ps-4">
                {events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p>{eventText(e)}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.kind === 'created' && !e.actor_id ? '' : `${name(e.actor_id)} · `}
                      {formatDate(locale, e.created_at, true)}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <div className="space-y-1">
            <a href={`/api/admissions/${encodeURIComponent(slug)}/leads/${lead.id}/export`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <Download aria-hidden />
              {a.lead.export}
            </a>
            <p className="text-xs text-muted-foreground">{a.lead.exportHint}</p>
          </div>

          {canManage ? (
            <ActionButton
              action={deleteLead}
              hidden={{ leadId: lead.id, tenant: slug, locale }}
              messages={messages}
              confirmMessage={a.lead.deleteConfirm}
              label={a.lead.delete}
              variant="danger"
              icon={<Trash2 aria-hidden />}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
