/**
 * Structure-aware chunking (pure). Input is the normalized text per page; output chunks keep
 * the nearest heading and the page range, so citations can point to "Handbook, p. 12".
 *
 * Sizes are in characters (≈ 400–600 tokens for English, a little more for Arabic). A chunk is
 * built from whole paragraphs; overly long paragraphs are split at sentence boundaries, and as a
 * last resort at a hard limit. Consecutive chunks overlap by their last paragraph (or ~15%), so a
 * fact split across a boundary is still retrievable.
 */

export type PageText = { page: number | null; text: string }
export type Chunk = { content: string; heading?: string; page_from?: number; page_to?: number }

export const CHUNK_TARGET = 1600
export const CHUNK_MAX = 2400
const OVERLAP_MAX = 400
const HEADING_MAX = 120

type Block = { text: string; page: number | null; heading: boolean }

/** A short line without sentence-ending punctuation that introduces the next paragraph. */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim()
  if (t.length < 3 || t.length > HEADING_MAX) return false
  if (/^#{1,6}\s/.test(t)) return true
  if (/[.,;:!?؟،؛]$/.test(t)) return false
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(t)) return true // "3.2 Fees"
  const words = t.split(/\s+/)
  if (words.length > 12) return false
  const latin = t.replace(/[^A-Za-z]/g, '')
  if (latin.length >= 3 && latin === latin.toUpperCase()) return true // "TUITION AND FEES"
  // Title Case or Arabic line: short and on its own.
  return words.length <= 8
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?؟۔\n]+(?:[.!?؟۔]+|\n|$)/g) ?? [text]
  return parts.map((s) => s.trim()).filter(Boolean)
}

function hardSplit(text: string, size: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf(' ', size)
    if (cut < size * 0.6) cut = size
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Paragraphs longer than the target are broken into sentence groups. */
function splitLong(text: string): string[] {
  if (text.length <= CHUNK_TARGET) return [text]
  const out: string[] = []
  let current = ''
  for (const sentence of splitSentences(text)) {
    for (const piece of sentence.length > CHUNK_TARGET ? hardSplit(sentence, CHUNK_TARGET) : [sentence]) {
      if (current && current.length + piece.length + 1 > CHUNK_TARGET) {
        out.push(current)
        current = ''
      }
      current = current ? `${current} ${piece}` : piece
    }
  }
  if (current) out.push(current)
  return out
}

function toBlocks(pages: PageText[], detectHeadings: boolean): Block[] {
  const blocks: Block[] = []
  for (const { page, text } of pages) {
    for (const para of text.split(/\n{2,}/)) {
      const lines = para.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length === 0) continue
      // A heading line glued to its paragraph ("Fees\nThe tuition fee is …").
      if (detectHeadings && lines.length > 1 && looksLikeHeading(lines[0]!)) {
        blocks.push({ text: lines[0]!.replace(/^#{1,6}\s+/, ''), page, heading: true })
        lines.shift()
      }
      const joined = lines.join(' ')
      if (detectHeadings && lines.length === 1 && looksLikeHeading(joined) && joined.length <= 80) {
        blocks.push({ text: joined.replace(/^#{1,6}\s+/, ''), page, heading: true })
        continue
      }
      for (const piece of splitLong(joined)) blocks.push({ text: piece, page, heading: false })
    }
  }
  return blocks
}

/** `detectHeadings: false` for tabular sources (CSV rows are short lines, not headings). */
export function chunkPages(pages: PageText[], { detectHeadings = true }: { detectHeadings?: boolean } = {}): Chunk[] {
  const blocks = toBlocks(pages, detectHeadings)
  const chunks: Chunk[] = []
  let heading: string | undefined
  let body: Block[] = []
  let size = 0
  // True while `body` only holds the overlap carried over from the previous chunk.
  let carriedOnly = false

  const flush = () => {
    if (body.length === 0) return
    const pagesUsed = body.map((b) => b.page).filter((p): p is number => p !== null)
    chunks.push({
      content: body.map((b) => b.text).join('\n\n').slice(0, 8000),
      heading,
      page_from: pagesUsed.length ? Math.min(...pagesUsed) : undefined,
      page_to: pagesUsed.length ? Math.max(...pagesUsed) : undefined,
    })
    // Overlap: carry the last paragraph into the next chunk when it is small enough.
    const last = body[body.length - 1]!
    body = last.text.length <= OVERLAP_MAX ? [last] : []
    size = body.reduce((n, b) => n + b.text.length, 0)
    carriedOnly = body.length > 0
  }

  for (const block of blocks) {
    if (block.heading) {
      // A new section starts a new chunk (without overlap from the previous section).
      if (body.some((b) => !b.heading)) flush()
      body = []
      size = 0
      carriedOnly = false
      heading = block.text.slice(0, 300)
      continue
    }
    if (size > 0 && !carriedOnly && size + block.text.length > CHUNK_TARGET) flush()
    body.push(block)
    size += block.text.length
    carriedOnly = false
    if (size >= CHUNK_MAX) flush()
  }
  // Do not emit a trailing chunk that only repeats the overlap of the previous one.
  if (body.length && !carriedOnly) flush()
  return chunks
}
