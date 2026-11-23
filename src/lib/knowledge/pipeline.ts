import 'server-only'
import { logger } from '@/lib/logger'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import { chunkPages, type Chunk } from './chunk'
import { getEmbeddingProvider, toVectorLiteral } from './embeddings'
import { ExtractionError, extractText } from './extract'
import { contentMatchesType, KNOWLEDGE_TYPES, type KnowledgeMimeType } from './file-types'

/**
 * Ingestion of one document version: download → verify → extract → normalize → chunk →
 * store (atomic version activation in the database) → embed (when a provider is configured).
 *
 * Runs with the uploader's session (RLS + the knowledge_* functions authorize every step),
 * after the upload request has been answered (`after()` in the Server Action). A failure
 * leaves the version in `failed` / `needs_ocr` with a safe error code; it can be retried.
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

const log = logger.child({ module: 'knowledge' })

/** PDFs with less text than this per page are treated as scanned (no text layer). */
const MIN_CHARS_PER_PDF_PAGE = 25

export type ProcessResult = { status: 'ready' | 'failed' | 'needs_ocr'; errorCode?: string; chunks?: number }

export function analyzeExtraction(type: KnowledgeMimeType, pages: { text: string }[], pageCount: number | null) {
  const charCount = pages.reduce((n, p) => n + p.text.length, 0)
  if (type === 'application/pdf') {
    const perPage = charCount / Math.max(1, pageCount ?? pages.length)
    if (charCount === 0 || perPage < MIN_CHARS_PER_PDF_PAGE) return { charCount, verdict: 'needs_ocr' as const }
  }
  if (charCount < 10) return { charCount, verdict: 'no_text' as const }
  return { charCount, verdict: 'ok' as const }
}

async function fail(supabase: Supabase, versionId: string, status: 'failed' | 'needs_ocr', errorCode: string): Promise<ProcessResult> {
  const { error } = await supabase.rpc('knowledge_set_version_status', { p_version: versionId, p_status: status, p_error_code: errorCode })
  if (error) log.error('knowledge.status_update_failed', { versionId, code: error.code })
  log.info('knowledge.version_not_ready', { versionId, status, errorCode })
  return { status, errorCode }
}

export async function processKnowledgeVersion(supabase: Supabase, versionId: string): Promise<ProcessResult> {
  const started = Date.now()
  const begin = await supabase.rpc('knowledge_set_version_status', { p_version: versionId, p_status: 'processing' })
  if (begin.error) {
    log.error('knowledge.processing_not_started', { versionId, code: begin.error.code })
    return { status: 'failed', errorCode: 'not_started' }
  }
  const { storage_path: path, mime_type: mime } = begin.data as { storage_path: string; mime_type: string }
  if (!(mime in KNOWLEDGE_TYPES)) return fail(supabase, versionId, 'failed', 'unsupported_type')
  const type = mime as KnowledgeMimeType

  const download = await supabase.storage.from('tenant-documents').download(path)
  if (download.error || !download.data) return fail(supabase, versionId, 'failed', 'storage_missing')
  const bytes = new Uint8Array(await download.data.arrayBuffer())
  if (!contentMatchesType(bytes, type)) return fail(supabase, versionId, 'failed', 'unsupported_type')

  let chunks: Chunk[]
  let stats: { page_count: number | null; char_count: number }
  try {
    const extracted = await extractText(bytes, type)
    const analysis = analyzeExtraction(type, extracted.pages, extracted.pageCount)
    if (analysis.verdict === 'needs_ocr') return fail(supabase, versionId, 'needs_ocr', 'no_text_layer')
    if (analysis.verdict === 'no_text') return fail(supabase, versionId, 'failed', 'no_text')
    chunks = chunkPages(extracted.pages, { detectHeadings: !extracted.tabular })
    stats = { page_count: extracted.pageCount, char_count: analysis.charCount }
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : 'extraction_failed'
    if (!(error instanceof ExtractionError)) log.error('knowledge.extraction_crashed', { versionId, error })
    return fail(supabase, versionId, 'failed', code)
  }
  if (chunks.length === 0) return fail(supabase, versionId, 'failed', 'no_text')
  if (chunks.length > 5000) return fail(supabase, versionId, 'failed', 'too_many_chunks')

  const stored = await supabase.rpc('knowledge_complete_version', { p_version: versionId, p_stats: stats, p_chunks: chunks })
  if (stored.error) {
    log.error('knowledge.store_failed', { versionId, code: stored.error.code })
    return fail(supabase, versionId, 'failed', 'store_failed')
  }

  // Embeddings are an enhancement: a failure keeps the version searchable by full text.
  const provider = getEmbeddingProvider()
  if (provider) {
    try {
      const vectors = await provider.embed(
        chunks.map((c) => (c.heading ? `${c.heading}\n${c.content}` : c.content)),
        'document',
      )
      const items = vectors.map((v, i) => ({ chunk_index: i, embedding: toVectorLiteral(v) }))
      const saved = await supabase.rpc('knowledge_set_embeddings', { p_version: versionId, p_model: provider.model, p_items: items })
      if (saved.error) log.warn('knowledge.embeddings_not_saved', { versionId, code: saved.error.code })
    } catch (error) {
      log.warn('knowledge.embeddings_failed', { versionId, error })
    }
  }

  log.info('knowledge.version_ready', { versionId, chunks: chunks.length, ms: Date.now() - started })
  return { status: 'ready', chunks: chunks.length }
}
