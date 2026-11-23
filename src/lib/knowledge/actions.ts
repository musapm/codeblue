'use server'

import { createHash } from 'node:crypto'
import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { toFieldErrors } from '@/lib/auth/schemas'
import { localizedPath } from '@/lib/i18n/config'
import { beginAction, dbFailure, formValues, isActionContext, isRateLimited, log, readLocale } from '@/lib/management/action-helpers'
import { errorState, successState, type ActionState } from '@/lib/management/action-state'
import { slugField } from '@/lib/management/schemas'
import type { Json } from '@/lib/supabase/database.types'
import { contentMatchesType, KNOWLEDGE_MAX_BYTES, KNOWLEDGE_TYPES, type KnowledgeMimeType } from './file-types'
import { processKnowledgeVersion } from './pipeline'
import { knowledgeMetaSchema, toMetaJson, type KnowledgeMetaInput } from './schemas'

/**
 * Knowledge base Server Actions. Files go from the browser straight to the private bucket
 * through a one-time signed upload URL (no 4–5 MB request-body limit, no file bytes through
 * our server on upload); the server then verifies the stored file and processes it after the
 * response (`after()`), with the uploader's session. Every step is authorized again by the
 * database (knowledge_* functions, storage policies).
 */

const uuid = z.uuid()
const courseMaterialMetaSchema = z.object({
  title: z.string().trim().min(2, 'nameRequired').max(200, 'nameTooLong'),
  titleAr: z
    .string()
    .trim()
    .max(200, 'nameTooLong')
    .optional()
    .transform((s) => (s ? s : null)),
})

export type BeginUploadInput = {
  tenant: string
  /** Phase 9: a course material (only its title is asked; the course decides who reads it). */
  courseId?: string
  documentId?: string
  fileName: string
  size: number
  type: string
  meta?: Partial<KnowledgeMetaInput>
}
export type BeginUploadResult = { documentId: string; versionId: string; path: string; token: string }

export async function beginKnowledgeUpload(input: BeginUploadInput): Promise<ActionState<BeginUploadResult>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(input.tenant)
  const documentId = input.documentId ? uuid.safeParse(input.documentId) : null
  if (!slug.success || (documentId && !documentId.success)) return errorState('invalid')
  if (!(input.type in KNOWLEDGE_TYPES)) return errorState('invalid', { file: 'knowledgeFileType' })
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > KNOWLEDGE_MAX_BYTES) return errorState('invalid', { file: 'knowledgeFileTooLarge' })
  const fileName = String(input.fileName ?? '').slice(0, 255)
  if (!fileName.trim()) return errorState('invalid', { file: 'fileRequired' })

  const courseId = input.courseId ? uuid.safeParse(input.courseId) : null
  if (courseId && !courseId.success) return errorState('invalid')

  let meta: { [key: string]: Json } = {}
  if (!documentId && courseId) {
    const parsed = courseMaterialMetaSchema.safeParse(input.meta ?? {})
    if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
    meta = { title: parsed.data.title, title_ar: parsed.data.titleAr }
  } else if (!documentId) {
    const parsed = knowledgeMetaSchema.safeParse(input.meta ?? {})
    if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
    meta = toMetaJson(parsed.data)
  }
  if (await isRateLimited('upload', ctx.user.id)) return errorState('rateLimited')

  const begun = courseId
    ? await ctx.supabase.rpc('academic_begin_upload', {
        p_course: courseId.data!,
        p_document: documentId ? documentId.data! : null,
        p_file_name: fileName,
        p_mime_type: input.type,
        p_size_bytes: input.size,
        p_meta: meta,
      })
    : await ctx.supabase.rpc('knowledge_begin_upload', {
        p_tenant_slug: slug.data,
        p_document: documentId ? documentId.data! : null,
        p_file_name: fileName,
        p_mime_type: input.type,
        p_size_bytes: input.size,
        p_meta: meta,
      })
  if (begun.error) return begun.error.code === '55P03' ? errorState('conflict') : dbFailure('knowledge_begin_upload', begun.error)
  const row = begun.data as { document_id: string; version_id: string; storage_path: string }

  const signed = await ctx.supabase.storage.from('tenant-documents').createSignedUploadUrl(row.storage_path)
  if (signed.error || !signed.data) {
    log.error('knowledge.signed_upload_failed', { message: signed.error?.message })
    return errorState('generic')
  }
  return successState({ documentId: row.document_id, versionId: row.version_id, path: row.storage_path, token: signed.data.token })
}

/** Verify the uploaded file (size, signature, hash), queue it and process it after responding. */
export async function finishKnowledgeUpload(input: { versionId: string }): Promise<ActionState<{ versionId: string }>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const versionId = uuid.safeParse(input.versionId)
  if (!versionId.success) return errorState('invalid')

  const version = await ctx.supabase
    .from('knowledge_document_versions')
    .select('id, storage_path, mime_type, size_bytes, status')
    .eq('id', versionId.data)
    .maybeSingle()
  if (version.error) return dbFailure('knowledge_version_read', version.error)
  if (!version.data) return errorState('notFound')
  if (version.data.status !== 'uploading') return errorState('conflict')

  const file = await ctx.supabase.storage.from('tenant-documents').download(version.data.storage_path)
  const reject = async (key: 'knowledgeFileType' | 'knowledgeFileMismatch') => {
    await ctx.supabase.rpc('knowledge_set_version_status', { p_version: versionId.data, p_status: 'failed', p_error_code: 'unsupported_type' })
    await ctx.supabase.storage.from('tenant-documents').remove([version.data!.storage_path])
    refresh()
    return errorState('invalid', { file: key })
  }
  if (file.error || !file.data) return errorState('notFound')
  const bytes = new Uint8Array(await file.data.arrayBuffer())
  if (bytes.length !== version.data.size_bytes) return reject('knowledgeFileMismatch')
  if (!contentMatchesType(bytes, version.data.mime_type as KnowledgeMimeType)) return reject('knowledgeFileType')

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const queued = await ctx.supabase.rpc('knowledge_set_version_status', { p_version: versionId.data, p_status: 'queued', p_sha256: sha256 })
  if (queued.error) return dbFailure('knowledge_queue', queued.error)

  const supabase = ctx.supabase
  after(async () => {
    await processKnowledgeVersion(supabase, versionId.data)
  })
  refresh()
  return successState({ versionId: versionId.data })
}

/** Re-run processing for a failed / needs-OCR version (e.g. after a parser fix). */
export async function retryKnowledgeVersion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const versionId = uuid.safeParse(formData.get('versionId'))
  if (!versionId.success) return errorState('invalid')
  const supabase = ctx.supabase
  // The status transition inside the pipeline re-checks permissions and the allowed states.
  after(async () => {
    await processKnowledgeVersion(supabase, versionId.data)
  })
  refresh()
  return successState()
}

export async function updateKnowledgeDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const documentId = uuid.safeParse(formData.get('documentId'))
  if (!documentId.success) return errorState('invalid')
  const parsed = knowledgeMetaSchema.safeParse(readMetaForm(formData))
  if (!parsed.success) return errorState('invalid', toFieldErrors(parsed.error))
  const { error } = await ctx.supabase.rpc('knowledge_update_document', { p_document: documentId.data, p_meta: toMetaJson(parsed.data) })
  if (error) return dbFailure('knowledge_update', error)
  refresh()
  return successState()
}

export async function setKnowledgePublished(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const documentId = uuid.safeParse(formData.get('documentId'))
  if (!documentId.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('knowledge_set_published', { p_document: documentId.data, p_published: formData.get('published') === 'true' })
  if (error) return dbFailure('knowledge_publish', error)
  refresh()
  return successState()
}

export async function setKnowledgeArchived(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const documentId = uuid.safeParse(formData.get('documentId'))
  if (!documentId.success) return errorState('invalid')
  const { error } = await ctx.supabase.rpc('knowledge_set_archived', { p_document: documentId.data, p_archived: formData.get('archived') === 'true' })
  if (error) return dbFailure('knowledge_archive', error)
  refresh()
  return successState()
}

/** Delete a document (versions + chunks in one transaction), then its files. */
export async function deleteKnowledgeDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const locale = readLocale(formData)
  const documentId = uuid.safeParse(formData.get('documentId'))
  const slug = slugField.safeParse(formData.get('tenant'))
  if (!documentId.success || !slug.success) return errorState('invalid')
  const deleted = await ctx.supabase.rpc('knowledge_delete_document', { p_document: documentId.data })
  if (deleted.error) return dbFailure('knowledge_delete', deleted.error)
  const paths = (deleted.data ?? []) as string[]
  if (paths.length) {
    const removed = await ctx.supabase.storage.from('tenant-documents').remove(paths)
    // The database rows are gone either way. Storage silently skips files the caller cannot
    // see, so compare counts: anything left over is logged for cleanup (migration 9 lets
    // knowledge managers see orphaned files so this normally removes all of them).
    if (removed.error || (removed.data?.length ?? 0) < paths.length) {
      log.warn('knowledge.file_cleanup_incomplete', { expected: paths.length, removed: removed.data?.length ?? 0 })
    }
  }
  redirect(localizedPath(locale, `/app/${slug.data}/knowledge`))
}

export type SearchHit = {
  chunk_id: number
  document_id: string
  title: string
  title_ar: string | null
  page_from: number | null
  page_to: number | null
  heading: string | null
  content: string
  score: number
  version_no: number
  visibility: string
}

/** "Test search": exactly what retrieval returns for the signed-in user. */
export async function testKnowledgeSearch(_prev: ActionState<SearchHit[]>, formData: FormData): Promise<ActionState<SearchHit[]>> {
  const ctx = await beginAction()
  if (!isActionContext(ctx)) return ctx
  const slug = slugField.safeParse(formData.get('tenant'))
  const q = z.string().trim().min(2).max(500).safeParse(formData.get('q'))
  if (!slug.success) return errorState('invalid')
  if (!q.success) return errorState('invalid', { q: 'searchQueryRequired' })
  const { data, error } = await ctx.supabase.rpc('search_knowledge', { p_tenant_slug: slug.data, p_query: q.data, p_limit: 8 })
  if (error) return dbFailure('search_knowledge', error)
  return successState((data ?? []) as SearchHit[])
}

function readMetaForm(formData: FormData) {
  const v = formValues(formData, ['title', 'titleAr', 'description', 'language', 'departmentId', 'category', 'visibility', 'effectiveDate', 'expiryDate', 'sourceUrl', 'sourcePriority'] as const)
  return {
    ...v,
    isAuthoritative: formData.get('isAuthoritative') === 'on',
    accessDepartmentIds: formData.getAll('accessDepartmentIds').map(String),
    accessRoleIds: formData.getAll('accessRoleIds').map(String),
  }
}
