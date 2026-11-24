import { logger } from '@/lib/logger'

/**
 * pdf.js can reject an internal promise late, after a damaged PDF has been handled (found by the
 * Phase 16 upload fuzzing). Next.js logs unhandled rejections and keeps running, but a plain
 * Node.js process (a background worker) stops on one. This guard recognises pdf.js's own error
 * types only and logs them as warnings; every other unhandled rejection keeps Node's normal
 * behaviour (re-thrown when no other listener handles it).
 */

const PDFJS_ERRORS = new Set([
  'AbortException',
  'BaseException',
  'DocException',
  'FormatError',
  'InvalidPDFException',
  'MissingDataException',
  'ParserEOFException',
  'PasswordException',
  'ResponseException',
  'UnknownErrorException',
  'XRefEntryException',
  'XRefParseException',
])

export function isPdfJsError(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && PDFJS_ERRORS.has(String((reason as { name?: unknown }).name))
}

const KEY = Symbol.for('uniagent.pdfRejectionGuard')

export function installPdfRejectionGuard(): void {
  const g = globalThis as { [KEY]?: boolean }
  if (g[KEY] || typeof process === 'undefined' || typeof process.on !== 'function') return
  g[KEY] = true
  const log = logger.child({ module: 'knowledge.pdf' })
  const listener = (reason: unknown) => {
    if (isPdfJsError(reason)) {
      log.warn('knowledge.pdfjs_late_rejection', { name: (reason as { name: string }).name })
      return
    }
    if (process.listenerCount('unhandledRejection') === 1) throw reason // nobody else: Node's default
  }
  process.on('unhandledRejection', listener)
}
