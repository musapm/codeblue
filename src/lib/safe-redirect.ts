/**
 * Open-redirect protection for `next` / `redirectTo` parameters.
 *
 * Only same-origin, absolute *paths* are accepted. Anything that could be interpreted by a
 * browser as another origin (`//evil.com`, `/\evil.com`, `https://…`, `javascript:`) or that
 * contains control characters falls back to the provided default.
 */

const PLACEHOLDER_ORIGIN = 'http://placeholder.invalid'

export function safeRedirectPath(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback
  const value = input.trim()
  if (value.length === 0 || value.length > 2048) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  // Backslashes and control characters are normalized unpredictably by browsers.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback

  let url: URL
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN)
  } catch {
    return fallback
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback

  // Decoded-path check: reject paths that become protocol-relative once decoded.
  try {
    if (decodeURIComponent(url.pathname).startsWith('//')) return fallback
  } catch {
    return fallback
  }

  return `${url.pathname}${url.search}${url.hash}`
}
