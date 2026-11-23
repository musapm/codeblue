// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { extractText, ExtractionError } = await import('./extract')
const { analyzeExtraction } = await import('./pipeline')
const { chunkPages } = await import('./chunk')
const { contentMatchesType } = await import('./file-types')

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)))

describe('real-file extraction', () => {
  it('English PDF: text per page, chunks with page numbers', async () => {
    const bytes = fixture('handbook-en.pdf')
    expect(contentMatchesType(bytes, 'application/pdf')).toBe(true)
    const out = await extractText(bytes, 'application/pdf')
    expect(out.pageCount).toBe(2)
    expect(out.pages[0]!.text).toContain('tuition fee for undergraduate programs is 1200')
    expect(out.pages[1]!.text).toContain('Registration for the next semester opens on 1 September')
    expect(analyzeExtraction('application/pdf', out.pages, out.pageCount).verdict).toBe('ok')
    const chunks = chunkPages(out.pages)
    expect(chunks.find((c) => c.content.includes('1200'))).toMatchObject({ page_from: 1 })
    expect(chunks.find((c) => c.content.includes('September'))).toMatchObject({ page_from: 2 })
  })

  it('Arabic PDF: words come out in logical (reading) order', async () => {
    const out = await extractText(fixture('handbook-ar.pdf'), 'application/pdf')
    const text = out.pages.map((p) => p.text).join('\n')
    expect(text).toContain('الرسوم الدراسية')
    expect(text).toContain('مكتب الشؤون المالية')
    expect(text).toContain('تُدفع') // diacritic stays attached to its letter
    expect(text).toContain('البكالوريوس ١٢٠٠ لكل فصل.') // numbers keep their order, punctuation at the end
    expect(text).not.toContain('ةيساردلا') // reversed letters would look like this
  })

  it('scanned PDF without a text layer is flagged for OCR', async () => {
    const out = await extractText(fixture('scanned.pdf'), 'application/pdf')
    expect(analyzeExtraction('application/pdf', out.pages, out.pageCount).verdict).toBe('needs_ocr')
  })

  it('DOCX: paragraphs in English and Arabic', async () => {
    const out = await extractText(fixture('policy.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(out.pages[0]!.text).toContain('postpone an exam for medical reasons')
    expect(out.pages[0]!.text).toContain('سياسة تأجيل الامتحانات')
  })

  it('damaged files fail with a safe code', async () => {
    await expect(extractText(fixture('not-a-docx.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).rejects.toMatchObject({ code: 'corrupt_file' })
    await expect(extractText(new TextEncoder().encode('%PDF-1.4 garbage'), 'application/pdf')).rejects.toBeInstanceOf(ExtractionError)
  })
})
