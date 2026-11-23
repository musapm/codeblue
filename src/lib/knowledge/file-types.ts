/**
 * Accepted knowledge-source formats (client-safe). The database and the storage bucket
 * enforce the same list; the content check below runs on the server after upload.
 */

export const KNOWLEDGE_MAX_BYTES = 25 * 1024 * 1024

export const KNOWLEDGE_TYPES = {
  'application/pdf': { ext: 'pdf', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', label: 'DOCX' },
  'text/plain': { ext: 'txt', label: 'TXT' },
  'text/csv': { ext: 'csv', label: 'CSV' },
} as const

export type KnowledgeMimeType = keyof typeof KNOWLEDGE_TYPES

export const KNOWLEDGE_ACCEPT = '.pdf,.docx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv'

/** Resolve the declared type from the browser, falling back to the extension. */
export function knowledgeTypeFor(fileName: string, declared: string): KnowledgeMimeType | null {
  if (declared in KNOWLEDGE_TYPES) return declared as KnowledgeMimeType
  const ext = fileName.toLowerCase().split('.').pop()
  const hit = Object.entries(KNOWLEDGE_TYPES).find(([, v]) => v.ext === ext)
  return hit ? (hit[0] as KnowledgeMimeType) : null
}

/**
 * Verify the file content matches the declared type (magic bytes / UTF-8), so a renamed
 * executable or HTML file is never processed as a document.
 */
export function contentMatchesType(bytes: Uint8Array, type: KnowledgeMimeType): boolean {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b)
  switch (type) {
    case 'application/pdf':
      return starts([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return starts([0x50, 0x4b, 0x03, 0x04]) // ZIP container (mammoth validates the rest)
    case 'text/plain':
    case 'text/csv':
      return isUtf8Text(bytes)
  }
}

export function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  if (bytes.includes(0)) return false // binary
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}
