import 'server-only'
import type { KnowledgeMimeType } from './file-types'
import { normalizeExtractedText } from './normalize'
import { hasRtl, itemsToText } from './pdf-bidi'
import type { PageText } from './chunk'

/**
 * Text extraction per format. Throws ExtractionError with a safe code (shown to admins,
 * never the raw library message).
 */

export class ExtractionError extends Error {
  constructor(
    readonly code: 'corrupt_file' | 'encrypted_file' | 'no_text' | 'extraction_failed',
    message?: string,
  ) {
    super(message ?? code)
  }
}

export type Extracted = { pages: PageText[]; pageCount: number | null; tabular: boolean }

type PdfTextItem = { str?: string; dir?: string; transform?: number[]; width?: number; hasEOL?: boolean }

/** One page of pdf.js text items → text. Pages with right-to-left text are rebuilt in reading order. */
export function pageItemsToText(items: PdfTextItem[]): string {
  const textItems = items.filter((i): i is PdfTextItem & { str: string } => typeof i.str === 'string')
  if (hasRtl(textItems)) {
    return itemsToText(
      textItems.map((i) => ({ str: i.str, dir: i.dir, x: i.transform?.[4] ?? 0, y: i.transform?.[5] ?? 0, width: i.width, hasEOL: i.hasEOL })),
    )
  }
  return textItems.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('')
}

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const { getDocumentProxy } = await import('unpdf')
  let pdf
  try {
    // A copy: pdf.js may transfer (detach) the buffer it is given.
    pdf = await getDocumentProxy(new Uint8Array(bytes))
  } catch (error) {
    const name = (error as { name?: string }).name
    throw new ExtractionError(name === 'PasswordException' ? 'encrypted_file' : 'corrupt_file')
  }
  try {
    const pages: PageText[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      pages.push({ page: n, text: normalizeExtractedText(pageItemsToText(content.items as PdfTextItem[])) })
      page.cleanup()
    }
    return { pages, pageCount: pdf.numPages, tabular: false }
  } catch {
    throw new ExtractionError('extraction_failed')
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined)
  }
}

async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const mammoth = await import('mammoth')
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    return { pages: [{ page: null, text: normalizeExtractedText(value) }], pageCount: null, tabular: false }
  } catch {
    throw new ExtractionError('corrupt_file')
  }
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
}

/** RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const delimiter = (text.split('\n', 1)[0] ?? '').split(';').length > (text.split('\n', 1)[0] ?? '').split(',').length ? ';' : ','
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/** Each row becomes "Header: value · Header: value" so it reads well on its own. */
export function csvToText(text: string): string {
  const rows = parseCsv(text)
  if (rows.length === 0) return ''
  const [header, ...body] = rows
  if (body.length === 0) return header!.join(' · ')
  return body
    .map((r) =>
      r
        .map((v, i) => [header![i]?.trim() || `#${i + 1}`, v.trim()] as const)
        .filter(([, v]) => v !== '')
        .map(([h, v]) => `${h}: ${v}`)
        .join(' · '),
    )
    .join('\n\n')
}

export async function extractText(bytes: Uint8Array, type: KnowledgeMimeType): Promise<Extracted> {
  switch (type) {
    case 'application/pdf':
      return extractPdf(bytes)
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocx(bytes)
    case 'text/plain':
      return { pages: [{ page: null, text: normalizeExtractedText(decodeText(bytes)) }], pageCount: null, tabular: false }
    case 'text/csv':
      return { pages: [{ page: null, text: normalizeExtractedText(csvToText(decodeText(bytes))) }], pageCount: null, tabular: true }
  }
}
