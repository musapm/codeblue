/**
 * Text normalization for extracted documents (pure, shared with tests).
 *  - Unicode NFKC: Arabic presentation forms (common in PDFs) become regular letters,
 *    ligatures and full-width characters are unified.
 *  - Removes control characters, soft hyphens, zero-width characters (except ZWNJ used in
 *    Persian/Arabic typography) and the byte-order mark.
 *  - Joins words hyphenated across line breaks ("regis-\ntration") and normalizes whitespace
 *    while keeping paragraph breaks, which the chunker relies on.
 * Arabic search normalization (alef/yaa variants, diacritics) happens in the database
 * (app.normalize_search_text), so the stored text keeps its original spelling for citations.
 */
export function normalizeExtractedText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00AD\u200B\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
