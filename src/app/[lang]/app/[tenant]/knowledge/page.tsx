import Link from 'next/link'
import { ArrowRight, FileText } from 'lucide-react'
import { PageHeader } from '@/components/app-shell/page-header'
import { AutoRefresh } from '@/components/knowledge/auto-refresh'
import { KnowledgeSearchPanel } from '@/components/knowledge/search-panel'
import { KnowledgeUploadForm } from '@/components/knowledge/upload-form'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/misc'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getEmbeddingProvider } from '@/lib/knowledge/embeddings'
import { documentState, listKnowledgeDocuments } from '@/lib/knowledge/queries'
import { metaLabels, STATE_VARIANT, stateLabel } from '@/lib/knowledge/view'
import { listDepartments, listRoles } from '@/lib/management/queries'
import { formatDate, formMessages, roleLabel, writeMode } from '@/lib/management/view'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { getWorkspaceContext, requireWorkspaceAccess } from '@/lib/tenancy/context'

export default async function KnowledgePage({ params }: PageProps<'/[lang]/app/[tenant]/knowledge'>) {
  const { tenant: slug } = await params
  const { locale, dict } = await getI18n()
  const ctx = await getWorkspaceContext(locale, slug)
  requireWorkspaceAccess(ctx, { permission: 'knowledge.manage', feature: 'knowledge_base' })
  const k = dict.management.knowledge
  const messages = formMessages(dict)
  const { canWrite, notice } = writeMode(ctx, dict)
  const supabase = getSupabaseConfig()

  const tenantId = ctx.tenantId
  const [documents, departments, roles] = tenantId ? await Promise.all([listKnowledgeDocuments(tenantId), listDepartments(tenantId), listRoles(tenantId)]) : [[], [], []]
  const states = documents.map((d) => ({ doc: d, state: documentState(d) }))
  const busy = states.some((s) => s.state === 'uploading' || s.state === 'queued' || s.state === 'processing')
  const deptName = new Map(departments.map((d) => [d.id, (locale === 'ar' && d.nameAr) || d.name]))
  const base = localizedPath(locale, `/app/${slug}/knowledge`)

  return (
    <>
      <PageHeader title={k.title} description={k.subtitle} />
      <AutoRefresh active={busy} />
      {notice ? (
        <Alert variant="info" className="mb-6">
          {ctx.user.isPreview ? k.previewNotice : notice}
        </Alert>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-[1fr_28rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{k.list.heading}</CardTitle>
            </CardHeader>
            <CardContent>
              {states.length === 0 ? (
                <EmptyState icon={<FileText />} title={k.list.empty} />
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {states.map(({ doc, state }) => {
                    const current = doc.versions.find((v) => v.id === doc.currentVersionId)
                    return (
                      <li key={doc.id}>
                        <Link href={`${base}/${doc.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/60">
                          <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{(locale === 'ar' && doc.titleAr) || doc.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[doc.departmentId ? deptName.get(doc.departmentId) : null, doc.category, current?.chunkCount ? k.list.chunks(current.chunkCount) : null, formatDate(locale, doc.updatedAt)]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          <Badge variant="outline">{k.visibilityShort[doc.visibility]}</Badge>
                          <Badge variant={STATE_VARIANT[state]}>{stateLabel(dict, state)}</Badge>
                          <ArrowRight aria-hidden className="size-4 text-muted-foreground rtl:-scale-x-100" />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{k.search.heading}</CardTitle>
              <CardDescription>{k.search.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {getEmbeddingProvider() ? null : <p className="text-xs text-muted-foreground">{k.search.semanticOff}</p>}
              <KnowledgeSearchPanel
                tenant={slug}
                locale={locale}
                messages={messages}
                labels={{
                  query: k.search.query,
                  submit: k.search.submit,
                  empty: k.search.empty,
                  score: k.search.score,
                  pageSingle: k.detail.page(1, 1).replace('1', '{from}'),
                  pageRange: k.detail.page(1, 2).replace('1', '{from}').replace('2', '{to}'),
                  visibility: k.visibilityShort,
                }}
              />
            </CardContent>
          </Card>
        </div>

        {canWrite && supabase ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{k.upload.heading}</CardTitle>
              <CardDescription>{k.upload.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <KnowledgeUploadForm
                tenant={slug}
                supabaseUrl={supabase.url}
                supabaseKey={supabase.publishableKey}
                departments={departments.filter((d) => !d.archivedAt).map((d) => ({ id: d.id, label: (locale === 'ar' && d.nameAr) || d.name }))}
                roles={roles.map((r) => ({ id: r.id, label: roleLabel(dict, r.key, r.name) }))}
                labels={{ file: k.upload.file, submit: k.upload.submit, uploading: k.upload.uploading, verifying: k.upload.verifying, queued: k.upload.queued }}
                metaLabels={metaLabels(dict)}
                messages={messages}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
