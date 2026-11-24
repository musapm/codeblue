import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, ArrowLeft, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react'
import { SubmitButton } from '@/components/forms/submit-button'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { DefinitionFields } from '@/components/workflows/definition-fields'
import { VersionEditor } from '@/components/workflows/form-builder'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { listDepartments } from '@/lib/management/queries'
import { formatDate, formMessages, writeMode } from '@/lib/management/view'
import { departmentOptions } from '@/lib/staff/view'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'
import { activateFormAction, archiveFormAction, deleteFormAction, discardDraftAction, publishDraftAction, saveDefinitionAction } from '@/lib/workflows/actions'
import { getDefinition } from '@/lib/workflows/queries'
import { builderLabels, formTitle } from '@/lib/workflows/view'

const VERSION_BADGE = { draft: 'warning', published: 'success', retired: 'outline' } as const

/** One form: details, the draft editor, publishing, versions. Published versions never change. */
export default async function WorkflowFormPage({ params }: PageProps<'/[lang]/app/[tenant]/workflows/forms/[definitionId]'>) {
  const { tenant: slug, definitionId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'departments.manage', feature: 'workflow_agent' })
  if (!ctx.tenantId || ctx.user.isPreview) notFound()
  const [found, departments] = await Promise.all([getDefinition(ctx.tenantId, definitionId), listDepartments(ctx.tenantId)])
  if (!found) notFound()
  const { definition: d, versions, requests } = found
  const f = dict.workflows.forms
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)
  const draft = versions.find((v) => v.status === 'draft')
  const published = versions.find((v) => v.status === 'published')
  const source = draft ?? published
  const hidden = { definitionId: d.id, tenant: slug, locale }

  return (
    <>
      <Link href={localizedPath(locale, `/app/${slug}/workflows/forms`)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {f.back}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold" dir="auto">
          {formTitle(locale, d)}
        </h2>
        <Badge variant={d.status === 'active' ? 'success' : 'neutral'}>{f.statuses[d.status] ?? d.status}</Badge>
        <span className="text-sm text-muted-foreground">{published ? f.version(published.version_no) : f.noPublished}</span>
        <span className="text-sm text-muted-foreground">· {f.requests(requests)}</span>
      </div>
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      {canWrite ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {draft ? (
            <>
              <ActionButton action={publishDraftAction} hidden={hidden} messages={messages} confirmMessage={f.confirmPublish} label={f.publish} variant="primary" size="md" icon={<Send aria-hidden />} />
              {published ? <ActionButton action={discardDraftAction} hidden={hidden} messages={messages} confirmMessage={f.confirmDiscard} label={f.discard} size="md" icon={<Undo2 aria-hidden />} /> : null}
            </>
          ) : null}
          {d.status === 'active' ? (
            <ActionButton action={archiveFormAction} hidden={hidden} messages={messages} confirmMessage={f.confirmArchive} label={f.archive} size="md" icon={<Archive aria-hidden />} />
          ) : d.status === 'archived' && published ? (
            <ActionButton action={activateFormAction} hidden={hidden} messages={messages} label={f.activate} size="md" icon={<RotateCcw aria-hidden />} />
          ) : null}
          {requests === 0 ? <ActionButton action={deleteFormAction} hidden={hidden} messages={messages} confirmMessage={f.confirmDelete} label={f.delete} variant="ghost" size="md" icon={<Trash2 aria-hidden />} /> : null}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{f.editor}</CardTitle>
              <CardDescription>{draft ? f.editorDraft(draft.version_no) : f.editorNew}</CardDescription>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                <VersionEditor
                  definitionId={d.id}
                  initialFields={source?.fields ?? []}
                  initialTexts={{
                    instructions: source?.instructions ?? null,
                    instructionsAr: source?.instructions_ar ?? null,
                    confirmation: source?.confirmation ?? null,
                    confirmationAr: source?.confirmation_ar ?? null,
                  }}
                  labels={builderLabels(dict)}
                  messages={messages}
                />
              ) : (
                <ul className="list-disc space-y-1 ps-5 text-sm">
                  {(source?.fields ?? []).map((field) => (
                    <li key={field.key} dir="auto">
                      {(locale === 'ar' && field.label_ar) || field.label}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{f.details}</CardTitle>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                <ActionForm action={saveDefinitionAction} hidden={hidden} messages={messages}>
                  <DefinitionFields dict={dict} departments={departmentOptions(locale, departments)} definition={d} />
                  <SubmitButton pendingLabel={dict.management.saving}>{f.saveDetails}</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-muted-foreground" dir="auto">
                  {d.description}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{f.versions}</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{f.noPublished}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.version(v.version_no)}</span>
                    <Badge variant={VERSION_BADGE[v.status as keyof typeof VERSION_BADGE] ?? 'neutral'}>{f.versionStatuses[v.status] ?? v.status}</Badge>
                    {v.published_at ? <span className="text-xs text-muted-foreground">{f.published(formatDate(locale, v.published_at))}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
