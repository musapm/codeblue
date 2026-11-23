import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { chunkPages, looksLikeHeading, CHUNK_MAX } = await import('./chunk')
const { contentMatchesType, isUtf8Text, knowledgeTypeFor } = await import('./file-types')
const { normalizeExtractedText } = await import('./normalize')
const { csvToText, parseCsv } = await import('./extract')
const { analyzeExtraction } = await import('./pipeline')

const enc = (s: string) => new TextEncoder().encode(s)

describe('file types', () => {
  it('resolves types from the browser value or the extension', () => {
    expect(knowledgeTypeFor('Handbook.PDF', '')).toBe('application/pdf')
    expect(knowledgeTypeFor('x.docx', 'application/octet-stream')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(knowledgeTypeFor('fees.csv', 'text/csv')).toBe('text/csv')
    expect(knowledgeTypeFor('virus.exe', 'application/x-msdownload')).toBeNull()
    expect(knowledgeTypeFor('page.html', 'text/html')).toBeNull()
  })

  it('checks content signatures, not names', () => {
    expect(contentMatchesType(enc('%PDF-1.7\n...'), 'application/pdf')).toBe(true)
    expect(contentMatchesType(enc('<html><script>alert(1)</script>'), 'application/pdf')).toBe(false)
    expect(contentMatchesType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
    expect(contentMatchesType(enc('%PDF-'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
    expect(contentMatchesType(enc('Fees: 1200\nرسوم'), 'text/plain')).toBe(true)
    expect(isUtf8Text(new Uint8Array([0x4d, 0x5a, 0x00, 0x90]))).toBe(false) // binary with NUL
    expect(isUtf8Text(new Uint8Array([0xc3, 0x28]))).toBe(false) // invalid UTF-8
    expect(isUtf8Text(new Uint8Array([]))).toBe(false)
  })
})

describe('normalizeExtractedText', () => {
  it('unifies Arabic presentation forms, removes invisible characters, joins hyphenation', () => {
    const presentation = String.fromCodePoint(0xfee3, 0xfeae, 0xfea3, 0xfe92, 0xfe8e) // "مرحبا" as presentation forms
    expect(normalizeExtractedText(presentation)).toBe('مرحبا')
    expect(normalizeExtractedText('regis-\ntration  opens\u00AD\u200B today')).toBe('registration opens today')
    expect(normalizeExtractedText('a\r\nb\n\n\n\nc')).toBe('a\nb\n\nc')
    expect(normalizeExtractedText('\uFEFFtext\u0007')).toBe('text')
  })
})

describe('CSV', () => {
  it('parses quoted fields and semicolon files', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ])
    expect(parseCsv('Program;Fee\nMedicine;5000')).toEqual([
      ['Program', 'Fee'],
      ['Medicine', '5000'],
    ])
  })

  it('turns rows into self-contained lines', () => {
    expect(csvToText('Program,Fee,Currency\nMedicine,5000,SDG\nLaw,,SDG')).toBe('Program: Medicine · Fee: 5000 · Currency: SDG\n\nProgram: Law · Currency: SDG')
  })
})

describe('chunkPages', () => {
  it('keeps headings and page ranges', () => {
    const chunks = chunkPages([
      { page: 1, text: 'TUITION AND FEES\n\nThe tuition fee is 1200 per semester.\n\nFees are paid at the finance office.' },
      { page: 2, text: 'Registration\nRegistration opens on 1 September.' },
    ])
    expect(chunks).toEqual([
      { content: 'The tuition fee is 1200 per semester.\n\nFees are paid at the finance office.', heading: 'TUITION AND FEES', page_from: 1, page_to: 1 },
      { content: 'Registration opens on 1 September.', heading: 'Registration', page_from: 2, page_to: 2 },
    ])
  })

  it('splits long text near the target size with overlap and never exceeds the hard limit', () => {
    const sentence = 'Students must register for courses before the deadline announced by the registrar. '
    const chunks = chunkPages([{ page: 3, text: sentence.repeat(120) }])
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(CHUNK_MAX)
    expect(chunks.every((c) => c.page_from === 3 && c.page_to === 3)).toBe(true)
  })

  it('handles Arabic text and unpunctuated walls of text', () => {
    const arabic = chunkPages([{ page: null, text: 'الرسوم الدراسية\nتدفع الرسوم الدراسية في مكتب الشؤون المالية قبل بداية الفصل.' }])
    expect(arabic[0]).toMatchObject({ heading: 'الرسوم الدراسية' })
    expect(arabic[0]!.page_from).toBeUndefined()
    const wall = chunkPages([{ page: 1, text: 'x'.repeat(9000) }])
    expect(wall.every((c) => c.content.length <= CHUNK_MAX)).toBe(true)
    expect(wall.map((c) => c.content).join('')).toHaveLength(9000)
  })

  it('does not treat CSV rows as headings', () => {
    const rows = 'Program: Medicine · Fee: 5000\n\nProgram: Law · Fee: 3000'
    expect(chunkPages([{ page: null, text: rows }], { detectHeadings: false })).toEqual([{ content: rows, heading: undefined, page_from: undefined, page_to: undefined }])
  })

  it('heading heuristics', () => {
    expect(looksLikeHeading('3.2 Tuition fees')).toBe(true)
    expect(looksLikeHeading('ADMISSION REQUIREMENTS')).toBe(true)
    expect(looksLikeHeading('The fee is paid before the semester starts.')).toBe(false)
    expect(looksLikeHeading('هل يمكنني تأجيل الامتحان؟')).toBe(false)
  })
})

describe('analyzeExtraction', () => {
  it('flags scanned PDFs and empty files', () => {
    expect(analyzeExtraction('application/pdf', [{ text: '' }, { text: ' ' }], 2).verdict).toBe('needs_ocr')
    expect(analyzeExtraction('application/pdf', [{ text: 'Page 1' }], 10).verdict).toBe('needs_ocr')
    expect(analyzeExtraction('application/pdf', [{ text: 'x'.repeat(400) }], 2).verdict).toBe('ok')
    expect(analyzeExtraction('text/plain', [{ text: 'hi' }], null).verdict).toBe('no_text')
  })
})

describe('pdf bidi reconstruction', async () => {
  const { itemsToText, orderLine } = await import('./pdf-bidi')
  const glyphs = (word: string, x0: number, y = 100) => [...word].map((ch, i) => ({ str: ch, dir: 'rtl', x: x0 + i * 10, y, width: 10 }))

  it('reads visually stored Arabic glyphs right to left', () => {
    // "دليل الطالب" stored left-to-right as reversed glyph sequences.
    const line = [...glyphs([...'الطالب'].reverse().join(''), 0), { str: ' ', dir: 'ltr', x: 60, y: 100, width: 10 }, ...glyphs([...'دليل'].reverse().join(''), 70)]
    expect(orderLine(line)).toBe('دليل الطالب')
  })

  it('keeps numbers and Latin words left to right inside Arabic lines', () => {
    const line = [
      ...glyphs([...'فصل'].reverse().join(''), 0),
      { str: ' ', dir: 'ltr', x: 30, y: 100, width: 10 },
      { str: '1200', dir: 'ltr', x: 40, y: 100, width: 40 },
      { str: ' ', dir: 'ltr', x: 80, y: 100, width: 10 },
      ...glyphs([...'رسوم'].reverse().join(''), 90),
    ]
    expect(orderLine(line)).toBe('رسوم 1200 فصل')
  })

  it('orders lines top to bottom and leaves English pages alone', () => {
    const text = itemsToText([
      { str: 'Second line', x: 0, y: 80, width: 50 },
      { str: 'First line', x: 0, y: 100, width: 50 },
    ])
    expect(text).toBe('First line\nSecond line')
  })
})

describe('Arabic marks after NFKC', () => {
  it('keeps isolated harakat presentation forms attached to their letter', () => {
    for (const form of [0xfe78, 0xfe79]) {
      expect(normalizeExtractedText('ت' + String.fromCodePoint(form) + 'دفع')).toBe('تُدفع')
    }
  })
})
