import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, query, user, userAal2 } from './harness'

/**
 * Phase 16: two-step sign-in enforced by the database (migration 23). An account with a
 * verified factor reaches nothing with a first-step (aal1) session: not its university's data,
 * not its own rows, not the platform. People without a factor are unaffected.
 */

const U = {
  owner: '97000000-0000-4000-8000-00000000000a',
  staff: '97000000-0000-4000-8000-0000000000a1',
  platform: '97000000-0000-4000-8000-0000000000f1',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
const count = async (actor: Parameters<typeof query>[1], sql: string) => (await query(pool, actor, sql)).rows[0].n

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(`insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`, [Object.values(U)])
  await pool.query(`insert into public.platform_admins (user_id, role) values ($1, 'owner')`, [U.platform])
  const tenant = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.owner])).rows[0].id
  const m = (await pool.query(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, U.staff])).rows[0].id
  await pool.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = 'registrar'`, [tenant, m])
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('two-step sign-in', () => {
  it('without a factor, a first-step session works as before', async () => {
    expect(await count(user(U.owner), `select count(*)::int as n from public.tenants`)).toBe(1)
    expect((await query(pool, user(U.owner), `select public.my_tenant_access('uni-a') as r`)).rows[0].r.permissions.length).toBeGreaterThan(10)
  })

  it('an unverified factor changes nothing yet', async () => {
    await pool.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')`, [U.owner])
    expect(await count(user(U.owner), `select count(*)::int as n from public.tenants`)).toBe(1)
  })

  it('with a verified factor, a first-step session reaches nothing; a second-step session works', async () => {
    await pool.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified'), ($2, 'verified')`, [U.owner, U.platform])
    for (const sql of [`select count(*)::int as n from public.tenants`, `select count(*)::int as n from public.profiles`, `select count(*)::int as n from public.tenant_memberships`, `select count(*)::int as n from public.roles`])
      expect(await count(user(U.owner), sql), sql).toBe(0)
    expect((await query(pool, user(U.owner), `select public.my_tenant_access('uni-a') as r`)).rows[0].r).toBeNull()
    await expect(query(pool, user(U.owner), `select public.tenant_members('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.owner), `update public.profiles set full_name = 'x' where id = $1`, [U.owner])).resolves.toMatchObject({ rowCount: 0 })

    expect(await count(userAal2(U.owner), `select count(*)::int as n from public.tenants`)).toBe(1)
    expect((await query(pool, userAal2(U.owner), `select public.tenant_members('uni-a') as r`)).rows[0].r.length).toBe(2)
  })

  it('platform roles need the second step too, when a factor exists', async () => {
    await expect(query(pool, user(U.platform), `select public.platform_tenants()`)).rejects.toMatchObject({ code: '42501' })
    expect((await query(pool, userAal2(U.platform), `select public.platform_tenants() as r`)).rows[0].r).toHaveLength(1)
  })

  it('other people are unaffected', async () => {
    expect(await count(user(U.staff), `select count(*)::int as n from public.tenants`)).toBe(1)
  })
})
