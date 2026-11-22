import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURES } from './features/catalog'
import { PERMISSION_KEYS } from './permissions/catalog'

/** The app's catalogs and the database seed must never drift apart. */
const catalogSql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '20261121200228_catalog.sql'), 'utf8')

function seededKeys(table: 'permissions' | 'features'): string[] {
  const block = catalogSql.split(`insert into public.${table}`)[1]?.split(';')[0] ?? ''
  return [...block.matchAll(/\(\s*'([a-z_.]+)'/g)].map((m) => m[1]!).sort()
}

describe('catalog sync (TypeScript ↔ database seed)', () => {
  it('permissions match', () => {
    expect(seededKeys('permissions')).toEqual([...PERMISSION_KEYS].sort())
  })

  it('features match', () => {
    expect(seededKeys('features')).toEqual(Object.keys(FEATURES).sort())
  })
})
