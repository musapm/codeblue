// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Upload fuzzing (Phase 16): random and damaged files must end in a clean result or a known
 * ExtractionError code; never another exception, a hang, an oversized chunk, or a renamed
 * executable or web page accepted as a document. Seeded, so failures can be reproduced.
 */

const { extractText, ExtractionError } = await import('./extract')
const { chunkPages, CHUNK_MAX } = await import('./chunk')
const { contentMatchesType, knowledgeTypeFor, isUtf8Text } = await import('./file-types')
const { normalizeExtractedText } = await import('./normalize')

function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = prng(20261124)
const int = (max: number) => Math.floor(rand() * max)
const randomBytes = (n: number) => Uint8Array.from({ length: n }, () => int(256))
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)))

function mutate(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes)
  const kind = int(3)
  if (kind === 0) for (let i = 0; i < 1 + int(40); i++) out[int(out.length)] = int(256) // flip bytes
  if (kind === 1) return out.slice(0, Math.max(5, int(out.length))) // truncate, keeping the signature
  if (kind === 2) out.fill(0, 64 + int(256), 64 + int(256) + int(2048)) // zero a block
  return out
}

const KNOWN_CODES = ['corrupt_file', 'encrypted_file', 'no_text', 'extraction_failed']

async function extractsSafely(bytes: Uint8Array, type: Parameters<typeof extractText>[1]) {
  try {
    const out = await extractText(bytes, type)
    expect(Array.isArray(out.pages)).toBe(true)
    for (const p of out.pages) expect(typeof p.text).toBe('string')
    for (const c of chunkPages(out.pages)) expect(c.content.length).toBeLessThanOrEqual(CHUNK_MAX)
    return 'ok'
  } catch (error) {
    expect(error).toBeInstanceOf(ExtractionError)
    expect(KNOWN_CODES).toContain((error as InstanceType<typeof ExtractionError>).code)
    return (error as InstanceType<typeof ExtractionError>).code
  }
}

describe('upload fuzzing', () => {
  it('damaged PDFs end in text or a known error', async () => {
    const base = fixture('handbook-en.pdf')
    const outcomes = new Set<string>()
    for (let i = 0; i < 40; i++) outcomes.add(await extractsSafely(mutate(base), 'application/pdf'))
    expect(outcomes.size).toBeGreaterThan(0)
  }, 60_000)

  it('damaged DOCX files end in text or a known error', async () => {
    const base = fixture('policy.docx')
    for (let i = 0; i < 40; i++) await extractsSafely(mutate(base), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  }, 60_000)

  it('random bytes under every declared type end in a known error, never a crash', async () => {
    for (let i = 0; i < 25; i++) {
      const bytes = randomBytes(int(4096))
      await extractsSafely(bytes, 'application/pdf')
      await extractsSafely(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    }
  }, 60_000)

  it('hostile text: control characters, bidi marks, huge lines, CSV quoting', async () => {
    const pieces = ['\u0000', '‮', '‏', '﻿', '\r\n', '"', ',', '\t', 'مرحبا', 'Ä', '𝔘', '<script>alert(1)</script>', 'a'.repeat(5000)]
    for (let i = 0; i < 60; i++) {
      const text = Array.from({ length: 1 + int(200) }, () => pieces[int(pieces.length)]).join('')
      const bytes = new TextEncoder().encode(text)
      if (!isUtf8Text(bytes)) continue // NUL bytes: refused as binary before extraction
      for (const type of ['text/plain', 'text/csv'] as const) await extractsSafely(bytes, type)
      const normalized = normalizeExtractedText(text)
      expect(normalized).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
    }
  })

  it('renamed executables, web pages and archives are not accepted as documents', () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...randomBytes(100)])
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>')
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...randomBytes(50)])
    expect(contentMatchesType(exe, 'application/pdf')).toBe(false)
    expect(contentMatchesType(exe, 'text/plain')).toBe(false)
    expect(contentMatchesType(html, 'application/pdf')).toBe(false)
    expect(contentMatchesType(zip, 'application/pdf')).toBe(false)
    expect(contentMatchesType(new Uint8Array(), 'text/plain')).toBe(false)
    expect(knowledgeTypeFor('fees.pdf.exe', 'application/x-msdownload')).toBeNull()
    expect(knowledgeTypeFor('page.html', 'text/html')).toBeNull()
    expect(knowledgeTypeFor('../../etc/passwd', '')).toBeNull()
    expect(knowledgeTypeFor('FEES.PDF', '')).toBe('application/pdf')
  })
})

describe('the pdf.js rejection guard', () => {
  it('recognises only pdf.js error types', async () => {
    const { isPdfJsError } = await import('./pdf-guard')
    const pdfError = Object.assign(new Error('Bad (uncompressed) XRef entry'), { name: 'XRefEntryException' })
    expect(isPdfJsError(pdfError)).toBe(true)
    expect(isPdfJsError(new TypeError('x'))).toBe(false)
    expect(isPdfJsError('XRefEntryException')).toBe(false)
    expect(isPdfJsError(null)).toBe(false)
  })
})
