/**
 * Rebuilds reading-order text from positioned PDF text items (pure).
 *
 * PDF generators often store Arabic as individual glyphs placed left to right (visual
 * order), so naive concatenation yields reversed words ("بلاطلا ليلد" instead of
 * "دليل الطالب"). This groups items into lines by baseline, orders each line by x, and for
 * right-to-left lines reads from right to left while keeping embedded left-to-right runs
 * (Latin words, numbers) in their own order — the bidi behaviour readers expect.
 */

export type PositionedItem = { str: string; dir?: string; x: number; y: number; width?: number; hasEOL?: boolean }

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LTR_CHAR = /[A-Za-z0-9\u0660-\u0669\u06F0-\u06F9\u00C0-\u024F]/

type Kind = 'R' | 'L' | 'N'
const kindOf = (s: string): Kind => (RTL_CHAR.test(s) ? 'R' : LTR_CHAR.test(s) ? 'L' : 'N')

export function hasRtl(items: { str: string }[]): boolean {
  return items.some((i) => RTL_CHAR.test(i.str))
}

/** Order one visual line (items sorted by x ascending) into logical text. */
export function orderLine(visual: PositionedItem[]): string {
  const strong = visual.map((i) => kindOf(i.str))
  const rtlCount = strong.filter((k) => k === 'R').length
  const ltrCount = strong.filter((k) => k === 'L').length
  if (rtlCount === 0 || ltrCount > rtlCount) {
    // Left-to-right line (possibly with a few Arabic words, which keep visual order here).
    return joinItems(visual)
  }
  // Right-to-left line: read right to left, then restore the order inside LTR runs.
  const reversed = [...visual].reverse()
  const out: PositionedItem[] = []
  for (let i = 0; i < reversed.length; ) {
    if (kindOf(reversed[i]!.str) !== 'L') {
      out.push(reversed[i]!)
      i++
      continue
    }
    // Extend the LTR run across neutral items (spaces, ".", ",") that are followed by more LTR.
    let j = i
    let lastL = i
    while (j < reversed.length && kindOf(reversed[j]!.str) !== 'R') {
      if (kindOf(reversed[j]!.str) === 'L') lastL = j
      j++
    }
    out.push(...reversed.slice(i, lastL + 1).reverse())
    i = lastL + 1
  }
  return joinItems(out, true)
}

/** Concatenate items, inserting a space where glyphs are visibly apart. */
function joinItems(items: PositionedItem[], rtl = false): string {
  let text = ''
  let prev: PositionedItem | null = null
  for (const item of items) {
    // Never before a combining mark (Arabic diacritics are separate glyphs in many PDFs).
    if (prev && item.str && !/^\s/.test(item.str) && !/^\p{M}/u.test(item.str) && !/\s$/.test(text) && prev.width != null) {
      const gap = rtl ? prev.x - (item.x + (item.width ?? 0)) : item.x - (prev.x + prev.width)
      const size = Math.max(1, (prev.width ?? 0) / Math.max(1, prev.str.length))
      if (gap > size * 0.6 && gap > 1.5) text += ' '
    }
    text += item.str
    prev = item
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** Group items into lines (by baseline) and paragraphs (by larger vertical gaps). */
export function itemsToText(items: PositionedItem[]): string {
  const visible = items.filter((i) => i.str !== '')
  if (visible.length === 0) return ''
  const sorted = [...visible].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; items: PositionedItem[] }[] = []
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l.y - item.y) <= 2.5)
    if (line) line.items.push(item)
    else lines.push({ y: item.y, items: [item] })
  }
  lines.sort((a, b) => b.y - a.y)
  const gaps = lines.slice(1).map((l, i) => lines[i]!.y - l.y)
  const typical = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : 0
  return lines
    .map((line, i) => {
      const text = orderLine(line.items.sort((a, b) => a.x - b.x))
      const breakBefore = i > 0 && typical > 0 && gaps[i - 1]! > typical * 1.6
      return (breakBefore ? '\n' : '') + text
    })
    .filter((t) => t.trim() !== '')
    .join('\n')
}
