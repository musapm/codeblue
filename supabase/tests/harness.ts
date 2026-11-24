import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

/**
 * Database test harness: creates a throw-away database, applies the Supabase shim and
 * every migration in order, and lets tests run queries *as* a given Supabase role/user
 * inside a transaction that is always rolled back.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable PostgreSQL server (superuser), e.g.
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:db
 */

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

export type Actor = { kind: 'user'; id: string; anonymous?: boolean; aal?: 'aal1' | 'aal2' } | { kind: 'anon' } | { kind: 'service' }

export const user = (id: string): Actor => ({ kind: 'user', id })
/** A session after the second sign-in step (two-step sign-in, Phase 16). */
export const userAal2 = (id: string): Actor => ({ kind: 'user', id, aal: 'aal2' })
/** A Supabase anonymous sign-in (role authenticated, claim is_anonymous = true). */
export const visitor = (id: string): Actor => ({ kind: 'user', id, anonymous: true })
export const anon: Actor = { kind: 'anon' }
export const service: Actor = { kind: 'service' }

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export function readMigrations(): string {
  return migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n')
}

export async function createTestDatabase() {
  const adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) {
    throw new Error('TEST_DATABASE_URL is required (a disposable PostgreSQL server). See docs/testing.md.')
  }
  const name = `uniagent_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`create database ${name}`)
  await admin.end()

  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 })

  const setup = await pool.connect()
  try {
    await setup.query(readFileSync(join(__dirname, 'supabase-shim.sql'), 'utf8'))
    for (const file of migrationFiles()) {
      try {
        await setup.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
      }
    }
  } finally {
    setup.release()
  }

  return {
    pool,
    async drop() {
      await pool.end()
      const cleanup = new pg.Client({ connectionString: adminUrl })
      await cleanup.connect()
      await cleanup.query(`drop database if exists ${name} with (force)`)
      await cleanup.end()
    },
  }
}

/** Run `fn` as the given actor inside a transaction that is always rolled back. */
export async function as<T>(pool: pg.Pool, actor: Actor, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return runAs(pool, actor, fn, false)
}

/** Like `as`, but commits on success: for fixtures that later steps must see (e.g. invitations). */
export async function asCommitted<T>(pool: pg.Pool, actor: Actor, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return runAs(pool, actor, fn, true)
}

async function runAs<T>(pool: pg.Pool, actor: Actor, fn: (client: pg.PoolClient) => Promise<T>, commit: boolean): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const claims =
      actor.kind === 'user'
        ? { sub: actor.id, role: 'authenticated', is_anonymous: actor.anonymous ?? false, aal: actor.aal ?? 'aal1' }
        : actor.kind === 'anon'
          ? { role: 'anon' }
          : { role: 'service_role' }
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    const role = actor.kind === 'user' ? 'authenticated' : actor.kind === 'anon' ? 'anon' : 'service_role'
    await client.query(`set local role ${role}`)
    const result = await fn(client)
    if (commit) await client.query('commit')
    return result
  } finally {
    await client.query('rollback').catch(() => undefined)
    client.release()
  }
}

/** Convenience: single query as an actor, returning rows. */
export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<R>> {
  return as(pool, actor, (c) => c.query<R>(sql, params))
}
