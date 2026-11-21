import { cacheLife } from 'next/cache'

/**
 * Current year for copyright notices. Cached so statically prerendered pages can use it
 * under Cache Components (reading the clock directly would make the page dynamic).
 */
export async function getCopyrightYear(): Promise<number> {
  'use cache'
  cacheLife('days')
  return new Date().getFullYear()
}
