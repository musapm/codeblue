import 'server-only'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/** Read side of the knowledge base (RLS: app.can_read_knowledge decides what is returned). */

const log = logger.child({ module: 'knowledge' })

function fail(op: string, error: { code?: string }): never {
  log.error('knowledge.query_failed', { op, code: error.code })
  throw new AppError(error.code === '42501' ? 'forbidden' : 'internal', `${op} failed`)
}

export type VersionStatus = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed' | 'needs_ocr'

export type KnowledgeVersion = {
  id: string
  versionNo: number
  fileName: string
  mimeType: string
  sizeBytes: number
  status: VersionStatus
  errorCode: string | null
  pageCount: number | null
  chunkCount: number | null
  storagePath: string
  createdAt: string
  processedAt: string | null
}

export type KnowledgeDocument = {
  id: string
  title: string
  titleAr: string | null
  description: string | null
  language: 'en' | 'ar' | 'mixed'
  departmentId: string | null
  category: string | null
  visibility: 'public' | 'members' | 'staff' | 'restricted'
  isAuthoritative: boolean
  sourcePriority: number
  effectiveDate: string | null
  expiryDate: string | null
  sourceUrl: string | null
  currentVersionId: string | null
  publishedAt: string | null
  archivedAt: string | null
  updatedAt: string
  versions: KnowledgeVersion[]
}

export type DocumentState = VersionStatus | 'draft' | 'published' | 'archived' | 'expired'

/** One status for lists: in-flight or failed latest version first, then lifecycle. */
export function documentState(doc: KnowledgeDocument, today = new Date().toISOString().slice(0, 10)): DocumentState {
  const latest = doc.versions[0]
  if (latest && latest.status !== 'ready' && latest.id !== doc.currentVersionId) return latest.status
  if (doc.archivedAt) return 'archived'
  if (!doc.currentVersionId) return latest?.status ?? 'uploading'
  if (doc.expiryDate && doc.expiryDate < today) return 'expired'
  return doc.publishedAt ? 'published' : 'draft'
}

const DOC_COLUMNS =
  'id, title, title_ar, description, language, department_id, category, visibility, is_authoritative, source_priority, effective_date, expiry_date, source_url, current_version_id, published_at, archived_at, updated_at'
const VERSION_COLUMNS = 'id, document_id, version_no, file_name, mime_type, size_bytes, status, error_code, page_count, chunk_count, storage_path, created_at, processed_at'

type DocRow = {
  id: string
  title: string
  title_ar: string | null
  description: string | null
  language: string
  department_id: string | null
  category: string | null
  visibility: KnowledgeDocument['visibility']
  is_authoritative: boolean
  source_priority: number
  effective_date: string | null
  expiry_date: string | null
  source_url: string | null
  current_version_id: string | null
  published_at: string | null
  archived_at: string | null
  updated_at: string
}
type VersionRow = {
  id: string
  document_id: string
  version_no: number
  file_name: string
  mime_type: string
  size_bytes: number
  status: VersionStatus
  error_code: string | null
  page_count: number | null
  chunk_count: number | null
  storage_path: string
  created_at: string
  processed_at: string | null
}

function toVersion(v: VersionRow): KnowledgeVersion {
  return {
    id: v.id,
    versionNo: v.version_no,
    fileName: v.file_name,
    mimeType: v.mime_type,
    sizeBytes: v.size_bytes,
    status: v.status,
    errorCode: v.error_code,
    pageCount: v.page_count,
    chunkCount: v.chunk_count,
    storagePath: v.storage_path,
    createdAt: v.created_at,
    processedAt: v.processed_at,
  }
}

function toDocument(d: DocRow, versions: VersionRow[]): KnowledgeDocument {
  return {
    id: d.id,
    title: d.title,
    titleAr: d.title_ar,
    description: d.description,
    language: d.language === 'ar' || d.language === 'mixed' ? d.language : 'en',
    departmentId: d.department_id,
    category: d.category,
    visibility: d.visibility,
    isAuthoritative: d.is_authoritative,
    sourcePriority: d.source_priority,
    effectiveDate: d.effective_date,
    expiryDate: d.expiry_date,
    sourceUrl: d.source_url,
    currentVersionId: d.current_version_id,
    publishedAt: d.published_at,
    archivedAt: d.archived_at,
    updatedAt: d.updated_at,
    versions: versions.filter((v) => v.document_id === d.id).sort((a, b) => b.version_no - a.version_no).map(toVersion),
  }
}

export async function listKnowledgeDocuments(tenantId: string): Promise<KnowledgeDocument[]> {
  const supabase = await createSupabaseServerClient()
  const docs = await supabase.from('knowledge_documents').select(DOC_COLUMNS).eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(500)
  if (docs.error) fail('knowledge_documents', docs.error)
  const rows = (docs.data ?? []) as DocRow[]
  if (rows.length === 0) return []
  const versions = await supabase.from('knowledge_document_versions').select(VERSION_COLUMNS).in('document_id', rows.map((d) => d.id))
  if (versions.error) fail('knowledge_versions', versions.error)
  return rows.map((d) => toDocument(d, (versions.data ?? []) as VersionRow[]))
}

export type KnowledgeChunkPreview = { index: number; heading: string | null; pageFrom: number | null; pageTo: number | null; content: string }

export type KnowledgeDocumentDetail = KnowledgeDocument & {
  accessDepartmentIds: string[]
  accessRoleIds: string[]
  preview: KnowledgeChunkPreview[]
  downloadUrls: Record<string, string>
}

export async function getKnowledgeDocument(tenantId: string, documentId: string): Promise<KnowledgeDocumentDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(documentId)) return null
  const supabase = await createSupabaseServerClient()
  const doc = await supabase.from('knowledge_documents').select(DOC_COLUMNS).eq('tenant_id', tenantId).eq('id', documentId).maybeSingle()
  if (doc.error) fail('knowledge_document', doc.error)
  if (!doc.data) return null
  const d = doc.data as DocRow

  const [versions, access, chunks] = await Promise.all([
    supabase.from('knowledge_document_versions').select(VERSION_COLUMNS).eq('document_id', documentId),
    supabase.from('knowledge_document_access').select('department_id, role_id').eq('document_id', documentId),
    d.current_version_id
      ? supabase
          .from('knowledge_chunks')
          .select('chunk_index, heading, page_from, page_to, content')
          .eq('version_id', d.current_version_id)
          .order('chunk_index')
          .limit(6)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (versions.error) fail('knowledge_versions', versions.error)
  if (access.error) fail('knowledge_access', access.error)
  if (chunks.error) fail('knowledge_chunks', chunks.error)

  const versionRows = (versions.data ?? []) as VersionRow[]
  const stored = versionRows.filter((v) => v.status !== 'uploading').map((v) => v.storage_path)
  const downloadUrls: Record<string, string> = {}
  if (stored.length) {
    // Short-lived links, created for this user (storage select policy = can_read_knowledge).
    const signed = await supabase.storage.from('tenant-documents').createSignedUrls(stored, 300, { download: true })
    for (const s of signed.data ?? []) if (s.signedUrl && s.path) downloadUrls[s.path] = s.signedUrl
  }

  return {
    ...toDocument(d, versionRows),
    accessDepartmentIds: (access.data ?? []).map((a) => a.department_id).filter((x): x is string => Boolean(x)),
    accessRoleIds: (access.data ?? []).map((a) => a.role_id).filter((x): x is string => Boolean(x)),
    preview: ((chunks.data ?? []) as { chunk_index: number; heading: string | null; page_from: number | null; page_to: number | null; content: string }[]).map((c) => ({
      index: c.chunk_index,
      heading: c.heading,
      pageFrom: c.page_from,
      pageTo: c.page_to,
      content: c.content,
    })),
    downloadUrls,
  }
}
