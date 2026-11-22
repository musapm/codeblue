import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, as, createTestDatabase, query, service, user } from './harness'

/**
 * Tenant-isolation and authorization suite (docs/tenant-isolation.md §5).
 * Every test runs as a real database role with Supabase-style JWT claims, so Row Level
 * Security, grants and constraints are exercised exactly as the Data API would.
 */

const U = {
  ownerA: '00000000-0000-4000-8000-00000000000a',
  admissionsA: '00000000-0000-4000-8000-0000000000a1',
  financeA: '00000000-0000-4000-8000-0000000000a2',
  studentA: '00000000-0000-4000-8000-0000000000a3',
  ownerB: '00000000-0000-4000-8000-00000000000b',
  studentB: '00000000-0000-4000-8000-0000000000b3',
  platformOwner: '00000000-0000-4000-8000-0000000000f0',
  platformSupport: '00000000-0000-4000-8000-0000000000f1',
  outsider: '00000000-0000-4000-8000-0000000000ee',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
let deptAdmissionsA: string
let deptFinanceA: string
let deptAdmissionsB: string

async function addMember(tenant: string, userId: string, roleKey: string, departmentId?: string) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`,
    [tenant, userId],
  )
  const membership = rows[0]!.id
  await pool.query(
    `insert into public.membership_roles (tenant_id, membership_id, role_id)
     select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`,
    [tenant, membership, roleKey],
  )
  if (departmentId) {
    await pool.query(
      `insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`,
      [tenant, membership, departmentId],
    )
  }
  return membership
}

async function addDepartment(tenant: string, slug: string, name: string) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.departments (tenant_id, slug, name) values ($1, $2, $3) returning id`,
    [tenant, slug, name],
  )
  return rows[0]!.id
}

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool

  // Fixtures are created as a trusted backend session (no JWT claims), like a seed script.
  await pool.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'owner-a@a.example', '{"full_name":"Owner A"}'),
       ($2, 'admissions-a@a.example', '{"full_name":"Admissions A"}'),
       ($3, 'finance-a@a.example', '{"full_name":"Finance A"}'),
       ($4, 'student-a@a.example', '{"full_name":"Student A","locale":"ar"}'),
       ($5, 'owner-b@b.example', '{"full_name":"Owner B"}'),
       ($6, 'student-b@b.example', '{"full_name":"Student B"}'),
       ($7, 'owner@platform.example', '{"full_name":"Platform Owner"}'),
       ($8, 'support@platform.example', '{"full_name":"Platform Support"}'),
       ($9, 'outsider@x.example', '{}')`,
    Object.values(U),
  )
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1, 'en', 'Africa/Khartoum') as id`, [U.ownerA])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1, 'ar', 'Asia/Riyadh') as id`, [U.ownerB])).rows[0].id

  deptAdmissionsA = await addDepartment(tenantA, 'admissions', 'Admissions')
  deptFinanceA = await addDepartment(tenantA, 'finance', 'Finance')
  deptAdmissionsB = await addDepartment(tenantB, 'admissions', 'Admissions')

  await addMember(tenantA, U.admissionsA, 'admissions_staff', deptAdmissionsA)
  await addMember(tenantA, U.financeA, 'finance_staff', deptFinanceA)
  await addMember(tenantA, U.studentA, 'student')
  await addMember(tenantB, U.studentB, 'student')

  await pool.query(`insert into public.platform_admins (user_id, role) values ($1, 'owner'), ($2, 'support')`, [
    U.platformOwner,
    U.platformSupport,
  ])
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('fixtures', () => {
  it('creates profiles for new auth users via trigger', async () => {
    const { rows } = await pool.query(`select full_name, locale from public.profiles where id = $1`, [U.studentA])
    expect(rows[0]).toEqual({ full_name: 'Student A', locale: 'ar' })
  })

  it('copies the 13 system roles into each tenant', async () => {
    const { rows } = await pool.query(`select count(*)::int as n from public.roles where tenant_id = $1 and is_system`, [tenantA])
    expect(rows[0].n).toBe(13)
  })
})

describe('T1 · members only see their own university', () => {
  it('student A sees only tenant A', async () => {
    const { rows } = await query(pool, user(U.studentA), `select slug from public.tenants order by slug`)
    expect(rows.map((r) => r.slug)).toEqual(['uni-a'])
  })

  it('an outsider sees no tenants', async () => {
    const { rows } = await query(pool, user(U.outsider), `select slug from public.tenants`)
    expect(rows).toEqual([])
  })
})

describe('T2–T4 · cross-tenant reads and writes are blocked', () => {
  it('T2: owner A cannot read B departments even when filtering by B tenant_id', async () => {
    const { rows } = await query(pool, user(U.ownerA), `select id from public.departments where tenant_id = $1`, [tenantB])
    expect(rows).toEqual([])
  })

  it('T3: owner A updating a B department by id affects 0 rows', async () => {
    const res = await query(pool, user(U.ownerA), `update public.departments set name = 'Hacked' where id = $1`, [deptAdmissionsB])
    expect(res.rowCount).toBe(0)
  })

  it('T4: owner A cannot insert a department into tenant B', async () => {
    await expect(
      query(pool, user(U.ownerA), `insert into public.departments (tenant_id, slug, name) values ($1, 'x', 'Injected')`, [tenantB]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('T4b: owner A cannot add a member to tenant B', async () => {
    await expect(
      query(pool, user(U.ownerA), `insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2)`, [tenantB, U.outsider]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('T5 · composite foreign keys keep references inside one tenant', () => {
  it('a tenant-A membership cannot be linked to a tenant-B department', async () => {
    const membership = (await pool.query(`select id from public.tenant_memberships where user_id = $1`, [U.studentA])).rows[0].id
    await expect(
      query(pool, user(U.ownerA), `insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`, [
        tenantA,
        membership,
        deptAdmissionsB,
      ]),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('a tenant-A membership cannot receive a tenant-B role', async () => {
    const membership = (await pool.query(`select id from public.tenant_memberships where user_id = $1`, [U.studentA])).rows[0].id
    const roleB = (await pool.query(`select id from public.roles where tenant_id = $1 and key = 'university_owner'`, [tenantB])).rows[0].id
    await expect(
      query(pool, user(U.ownerA), `insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [
        tenantA,
        membership,
        roleB,
      ]),
    ).rejects.toMatchObject({ code: '23503' })
  })
})

describe('T6 · least privilege inside a tenant', () => {
  it('admissions staff see only their own membership (no members.read)', async () => {
    const { rows } = await query(pool, user(U.admissionsA), `select user_id from public.tenant_memberships`)
    expect(rows.map((r) => r.user_id)).toEqual([U.admissionsA])
  })

  it('admissions staff cannot create departments or change settings', async () => {
    await expect(
      query(pool, user(U.admissionsA), `insert into public.departments (tenant_id, slug, name) values ($1, 'new', 'New dept')`, [tenantA]),
    ).rejects.toMatchObject({ code: '42501' })
    const res = await query(pool, user(U.admissionsA), `update public.tenant_settings set self_signup_enabled = true where tenant_id = $1`, [tenantA])
    expect(res.rowCount).toBe(0)
  })

  it('a member with members.manage but without roles.manage cannot assign roles (no escalation)', async () => {
    // Give the finance user a custom role with members.manage only.
    await as(pool, user(U.ownerA), async (c) => {
      const role = (
        await c.query(`insert into public.roles (tenant_id, key, name) values ($1, 'member_manager', 'Member manager') returning id`, [tenantA])
      ).rows[0].id
      await c.query(`insert into public.role_permissions (tenant_id, role_id, permission_key) values ($1, $2, 'members.manage')`, [tenantA, role])
      const financeMembership = (await c.query(`select id from public.tenant_memberships where user_id = $1`, [U.financeA])).rows[0].id
      await c.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [tenantA, financeMembership, role])
      // Still inside the owner's transaction: switch identity to the finance user.
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.financeA, role: 'authenticated' })])
      const ownerRole = (await c.query(`select id from public.roles where tenant_id = $1 and key = 'university_owner'`, [tenantA])).rows[0].id
      await expect(
        c.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [tenantA, financeMembership, ownerRole]),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('system roles cannot be edited through the API', async () => {
    const res = await query(pool, user(U.ownerA), `update public.roles set name = 'Renamed' where tenant_id = $1 and key = 'student'`, [tenantA])
    expect(res.rowCount).toBe(0)
  })
})

describe('T7 · students cannot see staff-only or personal data', () => {
  it('student A cannot read the audit log', async () => {
    const { rows } = await query(pool, user(U.studentA), `select id from public.audit_logs`)
    expect(rows).toEqual([])
  })

  it('student A cannot read other members or their profiles', async () => {
    const members = await query(pool, user(U.studentA), `select user_id from public.tenant_memberships`)
    expect(members.rows.map((r) => r.user_id)).toEqual([U.studentA])
    const profiles = await query(pool, user(U.studentA), `select id from public.profiles where id <> $1`, [U.studentA])
    expect(profiles.rows).toEqual([])
  })

  it('owner A (members.read) sees A profiles but never B profiles', async () => {
    const { rows } = await query(pool, user(U.ownerA), `select id from public.profiles`)
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(U.studentA)
    expect(ids).not.toContain(U.studentB)
    expect(ids).not.toContain(U.ownerB)
  })

  it('invitation token hashes are hidden from students', async () => {
    await pool.query(
      `insert into public.invitations (tenant_id, email, role_id, token_hash, expires_at)
       select $1, 'new@a.example', r.id, repeat('a', 64), now() + interval '7 days' from public.roles r where r.tenant_id = $1 and r.key = 'student'`,
      [tenantA],
    )
    const { rows } = await query(pool, user(U.studentA), `select token_hash from public.invitations`)
    expect(rows).toEqual([])
  })
})

describe('T8 · anonymous visitors have no access', () => {
  for (const table of ['tenants', 'tenant_memberships', 'profiles', 'departments', 'roles', 'audit_logs', 'platform_admins', 'invitations']) {
    it(`anon cannot read ${table}`, async () => {
      await expect(query(pool, anon, `select 1 from public.${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
    })
  }

  it('anon cannot call the tenant API functions', async () => {
    await expect(query(pool, anon, `select public.my_workspaces()`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.create_tenant('evil', 'Evil University')`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('T9 · no self-promotion across tenants or to platform roles', () => {
  it('owner A cannot give themself a role in tenant B', async () => {
    await expect(
      query(pool, user(U.ownerA), `insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2)`, [tenantB, U.ownerA]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('tenant owners cannot make themselves platform admins', async () => {
    await expect(
      query(pool, user(U.ownerA), `insert into public.platform_admins (user_id, role) values ($1, 'owner')`, [U.ownerA]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('tenant owners cannot change their tenant lifecycle status', async () => {
    const res = await query(pool, user(U.ownerA), `update public.tenants set status = 'active' where id = $1`, [tenantA])
    expect(res.rowCount).toBe(0)
  })

  it('non-platform users cannot create tenants via the API', async () => {
    await expect(query(pool, user(U.ownerA), `select public.create_tenant('rogue', 'Rogue University')`)).rejects.toMatchObject({
      code: '42501',
    })
  })
})

describe('T10 · suspension blocks a tenant immediately', () => {
  it('members of a suspended tenant lose data access but can see the status', async () => {
    await as(pool, service, async (c) => {
      await c.query(`update public.tenants set status = 'suspended' where id = $1`, [tenantA])
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.ownerA, role: 'authenticated' })])
      await c.query('set local role authenticated')
      expect((await c.query(`select id from public.departments`)).rows).toEqual([])
      const access = (await c.query(`select public.my_tenant_access('uni-a') as a`)).rows[0].a
      expect(access.tenant.status).toBe('suspended')
      expect(access.permissions).toEqual([])
      expect(access.features).toEqual([])
    })
  })
})

describe('T11–T13 · platform support access is explicit, time-boxed and audited', () => {
  it('T11: support staff without a grant see tenant metadata but no tenant data', async () => {
    const tenants = await query(pool, user(U.platformSupport), `select slug from public.tenants order by slug`)
    expect(tenants.rows.map((r) => r.slug)).toEqual(['uni-a', 'uni-b'])
    const depts = await query(pool, user(U.platformSupport), `select id from public.departments`)
    expect(depts.rows).toEqual([])
  })

  it('T11b: even the platform owner cannot see university members or profiles without a grant', async () => {
    const members = await query(pool, user(U.platformOwner), `select id from public.tenant_memberships`)
    expect(members.rows).toEqual([])
    const profiles = await query(pool, user(U.platformOwner), `select id from public.profiles where id = $1`, [U.studentA])
    expect(profiles.rows).toEqual([])
    const roles = await query(pool, user(U.platformOwner), `select id from public.roles`)
    expect(roles.rows).toEqual([])
  })

  it('T12: an active grant gives read access to that tenant only, and is audited', async () => {
    await as(pool, user(U.platformOwner), async (c) => {
      await c.query(
        `insert into public.support_access_grants (tenant_id, grantee_id, reason, granted_by, expires_at)
         values ($1, $2, 'Investigating a reported login issue', $3, now() + interval '1 hour')`,
        [tenantA, U.platformSupport, U.platformOwner],
      )
      const audit = await c.query(`select actor_type, action from public.audit_logs where action = 'support_access_grants.insert'`)
      expect(audit.rows).toEqual([{ actor_type: 'platform_admin', action: 'support_access_grants.insert' }])

      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.platformSupport, role: 'authenticated' })])
      const depts = await c.query(`select tenant_id from public.departments`)
      expect(depts.rows.length).toBeGreaterThan(0)
      expect(new Set(depts.rows.map((r) => r.tenant_id))).toEqual(new Set([tenantA]))
      const access = (await c.query(`select public.my_tenant_access('uni-a') as a`)).rows[0].a
      expect(access.access_via).toBe('support')
      expect(access.permissions).toEqual([])
    })
  })

  it('T13: an expired grant gives no access', async () => {
    await as(pool, user(U.platformOwner), async (c) => {
      await c.query(
        `insert into public.support_access_grants (tenant_id, grantee_id, reason, granted_by, starts_at, expires_at)
         values ($1, $2, 'Old investigation from yesterday', $3, now() - interval '3 hours', now() - interval '1 hour')`,
        [tenantA, U.platformSupport, U.platformOwner],
      )
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.platformSupport, role: 'authenticated' })])
      expect((await c.query(`select id from public.departments`)).rows).toEqual([])
    })
  })

  it('grants longer than 24 hours are rejected', async () => {
    await expect(
      query(
        pool,
        user(U.platformOwner),
        `insert into public.support_access_grants (tenant_id, grantee_id, reason, granted_by, expires_at)
         values ($1, $2, 'Long running investigation', $3, now() + interval '2 days')`,
        [tenantA, U.platformSupport, U.platformOwner],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('T14 · the audit log is append-only', () => {
  it('tenant changes are recorded with the actor', async () => {
    const { rows } = await pool.query(
      `select actor_type from public.audit_logs where action = 'tenant_memberships.insert' and tenant_id = $1`,
      [tenantA],
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('owner A can read A audit rows but not B rows', async () => {
    const { rows } = await query(pool, user(U.ownerA), `select distinct tenant_id from public.audit_logs`)
    expect(rows.map((r) => r.tenant_id)).toEqual([tenantA])
  })

  it('nobody can update, delete or insert audit rows through the API', async () => {
    for (const actor of [user(U.ownerA), user(U.platformOwner), service]) {
      await expect(query(pool, actor, `update public.audit_logs set action = 'tampered'`)).rejects.toMatchObject({ code: '42501' })
      await expect(query(pool, actor, `delete from public.audit_logs`)).rejects.toMatchObject({ code: '42501' })
      await expect(
        query(pool, actor, `insert into public.audit_logs (actor_type, action) values ('system', 'forged.entry')`),
      ).rejects.toMatchObject({ code: '42501' })
    }
  })
})

describe('T15 · private helpers are not callable by API roles', () => {
  it('anon has no access to the app schema', async () => {
    await expect(query(pool, anon, `select app.has_permission($1, 'members.read')`, [tenantA])).rejects.toMatchObject({ code: '42501' })
  })

  it('helpers only ever describe the caller', async () => {
    const { rows } = await query(pool, user(U.studentA), `select app.has_permission($1, 'members.read') as can`, [tenantA])
    expect(rows[0].can).toBe(false)
  })
})

describe('API functions', () => {
  it('my_workspaces lists only the caller’s active memberships', async () => {
    const { rows } = await query(pool, user(U.studentA), `select public.my_workspaces() as w`)
    expect(rows[0].w.map((w: { slug: string }) => w.slug)).toEqual(['uni-a'])
    const outsider = await query(pool, user(U.outsider), `select public.my_workspaces() as w`)
    expect(outsider.rows[0].w).toEqual([])
  })

  it('my_tenant_access returns null for non-members (no enumeration)', async () => {
    const existing = await query(pool, user(U.studentA), `select public.my_tenant_access('uni-b') as a`)
    const missing = await query(pool, user(U.studentA), `select public.my_tenant_access('does-not-exist') as a`)
    expect(existing.rows[0].a).toBeNull()
    expect(missing.rows[0].a).toBeNull()
  })

  it('my_tenant_access returns the caller’s real permissions, departments and features', async () => {
    const { rows } = await query(pool, user(U.admissionsA), `select public.my_tenant_access('UNI-A') as a`)
    const access = rows[0].a
    expect(access.tenant.slug).toBe('uni-a')
    expect(access.tenant.timezone).toBe('Africa/Khartoum')
    expect(access.roles).toEqual(['admissions_staff'])
    expect(access.permissions).toContain('leads.manage')
    expect(access.permissions).not.toContain('members.read')
    expect(access.department_ids).toEqual([deptAdmissionsA])
    expect(access.features).toContain('student_assistant')
  })

  it('my_platform_role identifies platform staff only', async () => {
    expect((await query(pool, user(U.platformOwner), `select public.my_platform_role() as r`)).rows[0].r).toBe('owner')
    expect((await query(pool, user(U.ownerA), `select public.my_platform_role() as r`)).rows[0].r).toBeNull()
  })

  it('platform owners can create tenants through the API', async () => {
    const { rows } = await query(pool, user(U.platformOwner), `select public.create_tenant('uni-c', 'University C') as id`)
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('data integrity constraints', () => {
  it('branding accepts only hex colors (CSS-injection defense)', async () => {
    await expect(
      query(pool, user(U.ownerA), `update public.tenant_branding set published = '{"primary":"red;background:url(x)"}' where tenant_id = $1`, [
        tenantA,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    const ok = await query(pool, user(U.ownerA), `update public.tenant_branding set published = '{"primary":"#0f766e"}' where tenant_id = $1`, [
      tenantA,
    ])
    expect(ok.rowCount).toBe(1)
  })

  it('tenant slugs and time zones are validated', async () => {
    await expect(pool.query(`select public.create_tenant('Bad Slug!', 'Bad')`)).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(`select public.create_tenant('ok-slug', 'Okay', null, 'en', 'Mars/Olympus')`)).rejects.toMatchObject({
      code: '22023',
    })
  })
})

describe('seed scripts', () => {
  it('demo seed is valid and idempotent', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const sql = readFileSync(join(__dirname, '..', 'seed', 'demo_northbridge.sql'), 'utf8')
    await pool.query(sql)
    await pool.query(sql)
    const { rows } = await pool.query(
      `select t.is_demo, t.name_translations ->> 'ar' as ar, b.published ->> 'primary' as primary,
              (select count(*)::int from public.departments d where d.tenant_id = t.id) as departments,
              (select count(*)::int from public.roles r where r.tenant_id = t.id) as roles
       from public.tenants t join public.tenant_branding b on b.tenant_id = t.id where t.slug = 'northbridge'`,
    )
    expect(rows).toEqual([{ is_demo: true, ar: 'جامعة نورثبريدج', primary: '#1b4f8f', departments: 7, roles: 13 }])
  })
})
