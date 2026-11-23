import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, ArchiveRestore, ArrowLeft, Download, Eye, EyeOff, RotateCw, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { SubmitButton } from '@/components/forms/submit-button'
import { AutoRefresh } from '@/components/knowledge/auto-refresh'
import { KnowledgeMetaFields } from '@/components/knowledge/meta-fields'
import { KnowledgeUploadForm } from '@/components/knowledge/upload-form'
import { ActionButton, ActionForm } from '@/components/management/action-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { deleteKnowledgeDocument, retryKnowledgeVersion, setKnowledgeArchived, setKnowledgePublished, updateKnowledgeDocument } from '@/lib/knowledge/actions'
import { documentState, getKnowledgeDocument } from '@/lib/knowledge/queries'
import { formatBytes, metaLabels, STATE_VARIANT, stateLabel } from '@/lib/knowledge/view'
import { listDepartments, listRoles } from '@/lib/management/queries'
import { formatDate, formMessages, roleLabel, writeMode } from '@/lib/management/view'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { getWorkspaceContext, hasWorkspacePermission, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function KnowledgeDocumentPage({ params }: PageProps<'/[lang]/app/[tenant]/knowledge/[documentId]'>) {
  const { tenant: slug, documentId } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'knowledge.manage', feature: 'knowledge_base' })
  if (!ctx.tenantId) notFound()
  const k = dict.management.knowledge
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)
  const canPublish = canWrite && hasWorkspacePermission(ctx, 'knowledge.publish')

  const [doc, departments, roles] = await Promise.all([getKnowledgeDocument(ctx.tenantId, documentId), listDepartments(ctx.tenantId), listRoles(ctx.tenantId)])
  if (!doc) notFound()
  const state = documentState(doc)
  const inFlight = doc.versions.some((v) => v.status === 'uploading' || v.status === 'queued' || v.status === 'processing')
  const hidden = { documentId: doc.id, tenant: slug, locale }
  const supabase = getSupabaseConfig()
  const title = (locale === 'ar' && doc.titleAr) || doc.title
  const pageLabel = (from: number | null, to: number | null) => (from == null ? null : k.detail.page(from, to ?? from))

  return (
    <>
      <AutoRefresh active={inFlight} />
      <Link href={localizedPath(locale, `/app/${slug}/knowledge`)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {k.detail.back}
      </Link>
      <PageHeader
        title={title}
        badge={
          <>
            <Badge variant={STATE_VARIANT[state]}>{stateLabel(dict, state)}</Badge>
            <Badge variant="outline">{k.visibilityShort[doc.visibility]}</Badge>
          </>
        }
      />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{k.detail.preview}</CardTitle>
              <CardDescription>{k.detail.previewHint}</CardDescription>
            </CardHeader>
            <CardContent>
              {doc.preview.length === 0 ? (
                <p className="text-sm text-muted-foreground">{k.search.empty}</p>
              ) : (
                <ol className="space-y-3">
                  {doc.preview.map((c) => (
                    <li key={c.index} className="rounded-lg border border-border p-3">
                      <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">#{c.index + 1}</span>
                        {pageLabel(c.pageFrom, c.pageTo) ? <span>{pageLabel(c.pageFrom, c.pageTo)}</span> : null}
                        {c.heading ? <span className="font-medium text-foreground">{c.heading}</span> : null}
                      </p>
                      <p className="mt-1.5 line-clamp-6 text-sm whitespace-pre-line" dir="auto">
                        {c.content}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>{k.detail.details}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={updateKnowledgeDocument} hidden={hidden} messages={messages}>
                  <KnowledgeMetaFields
                    defaults={doc}
                    departments={departments.filter((d) => !d.archivedAt || d.id === doc.departmentId).map((d) => ({ id: d.id, label: (locale === 'ar' && d.nameAr) || d.name }))}
                    roles={roles.map((r) => ({ id: r.id, label: roleLabel(dict, r.key, r.name) }))}
                    labels={metaLabels(dict)}
                  />
                  <SubmitButton pendingLabel={dict.management.saving}>{k.fields.save}</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{k.detail.overview}</CardTitle>
              <CardDescription>{k.detail.publishHint}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {canPublish && doc.currentVersionId ? (
                <ActionButton
                  action={setKnowledgePublished}
                  hidden={{ ...hidden, published: doc.publishedAt ? 'false' : 'true' }}
                  messages={messages}
                  label={doc.publishedAt ? k.detail.unpublish : k.detail.publish}
                  icon={doc.publishedAt ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  variant={doc.publishedAt ? 'secondary' : 'primary'}
                />
              ) : (
                <p className="text-xs text-muted-foreground">{k.detail.cannotPublish}</p>
              )}
              {canWrite ? (
                <>
                  <ActionButton
                    action={setKnowledgeArchived}
                    hidden={{ ...hidden, archived: doc.archivedAt ? 'false' : 'true' }}
                    messages={messages}
                    confirmMessage={doc.archivedAt ? undefined : k.detail.confirmArchive}
                    label={doc.archivedAt ? k.detail.restore : k.detail.archive}
                    icon={doc.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  />
                  <ActionButton action={deleteKnowledgeDocument} hidden={hidden} messages={messages} confirmMessage={k.detail.confirmDelete} label={k.detail.delete} icon={<Trash2 aria-hidden />} variant="danger" />
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{k.detail.versions}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="divide-y divide-border rounded-lg border border-border">
                {doc.versions.map((v) => {
                  const url = doc.downloadUrls[v.storagePath]
                  const vState = v.status === 'ready' ? (v.id === doc.currentVersionId ? state : 'ready') : v.status
                  return (
                    <li key={v.id} className="space-y-1.5 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium tabular-nums">v{v.versionNo}</span>
                        {v.id === doc.currentVersionId ? <Badge variant="primary">{k.detail.current}</Badge> : null}
                        <Badge variant={STATE_VARIANT[vState]}>{v.status === 'ready' ? stateLabel(dict, vState) : k.status[v.status]}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">
                        {v.fileName} · {formatBytes(v.sizeBytes, locale)}
                        {v.pageCount ? ` · ${k.detail.pages(v.pageCount)}` : ''}
                        {v.chunkCount ? ` · ${k.list.chunks(v.chunkCount)}` : ''} · {formatDate(locale, v.createdAt, true)}
                      </p>
                      {v.errorCode ? <p className="text-xs text-danger">{k.errors[v.errorCode] ?? v.errorCode}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        {url ? (
                          <a href={url} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" rel="noopener">
                            <Download aria-hidden className="size-3.5" />
                            {k.detail.download}
                          </a>
                        ) : null}
                        {canWrite && (v.status === 'failed' || v.status === 'needs_ocr') ? (
                          <ActionButton action={retryKnowledgeVersion} hidden={{ versionId: v.id }} messages={messages} label={k.detail.retry} icon={<RotateCw aria-hidden />} variant="ghost" />
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {canWrite && supabase && !inFlight ? (
                <div className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold">{k.upload.newVersion}</h3>
                  <p className="text-xs text-muted-foreground">{k.upload.newVersionHint}</p>
                  <KnowledgeUploadForm
                    tenant={slug}
                    documentId={doc.id}
                    supabaseUrl={supabase.url}
                    supabaseKey={supabase.publishableKey}
                    labels={{ file: k.upload.file, submit: k.upload.submit, uploading: k.upload.uploading, verifying: k.upload.verifying, queued: k.upload.queued }}
                    messages={messages}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
