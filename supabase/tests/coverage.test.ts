import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase } from './harness'

/**
 * Phase 16 coverage report, checked against the catalog after every migration:
 * row level security everywhere, deny-all tables listed on purpose, SECURITY DEFINER functions
 * with a fixed search_path, and the anonymous role limited to what is meant to be public.
 * A new table or function that breaks these rules fails this test.
 */

/** Tables with RLS and no policy on purpose: read only through functions that aggregate. */
const DENY_ALL = ['outbound_messages', 'voice_usage_events']
/** Functions callable without signing in. */
const ANON_FUNCTIONS = ['public_admissions', 'rate_limit_hit']

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
const rows = async (sql: string) => (await pool.query(sql)).rows

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('RLS and privilege coverage', () => {
  it('every table has row level security', async () => {
    expect(await rows(`select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname in ('public', 'app') and not c.relrowsecurity order by 1`)).toEqual([])
  })

  it('every public table has policies, except the deny-all tables listed on purpose', async () => {
    const tables = await rows(`select c.relname as t,
        (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.permissive = 'PERMISSIVE') as policies,
        (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'mfa_required' and p.permissive = 'RESTRICTIVE') as mfa
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname = 'public' order by 1`)
    expect(tables.length).toBeGreaterThan(60)
    expect(tables.filter((t) => t.policies === 0).map((t) => t.t)).toEqual(DENY_ALL)
    expect(tables.filter((t) => t.mfa !== 1).map((t) => t.t)).toEqual([]) // two-step sign-in on every table (migration 23)
  })

  it('every SECURITY DEFINER function fixes its search_path', async () => {
    const definers = await rows(`select n.nspname || '.' || p.proname as f,
        exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""' or c = 'search_path=') as empty_path
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosecdef`)
    expect(definers.length).toBeGreaterThan(150)
    expect(definers.filter((d) => !d.empty_path).map((d) => d.f)).toEqual([])
  })

  it('the anonymous role reaches only what is meant to be public', async () => {
    expect(await rows(`select table_schema, table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'anon' and table_schema in ('public', 'app', 'storage')`)).toEqual([])
    const anonFunctions = (await rows(`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).map((r) => r.f)
    expect(anonFunctions).toEqual(ANON_FUNCTIONS)
  })

  it('private tables are not granted to API roles', async () => {
    expect(await rows(`select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'app' and grantee in ('anon', 'authenticated')`)).toEqual([])
  })

  it('every public function is reachable only by signed-in users or the service role, unless listed', async () => {
    const publicExec = (await rows(`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('public', p.oid, 'execute') order by 1`)).map((r) => r.f)
    expect(publicExec.filter((f) => !ANON_FUNCTIONS.includes(f))).toEqual([])
  })
})
