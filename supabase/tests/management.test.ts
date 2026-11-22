import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anon, as, asCommitted, createTestDatabase, query, user } from './harness'

/**
 * Phase 3 (university management) database tests: invitations and their escalation
 * rules, member listing, the last-owner guard, tenant profile + branding publishing,
 * platform overview functions, and tenant-scoped storage (isolation test T16).
 */

const U = {
  ownerA: '10000000-0000-4000-8000-00000000000a',
  deptAdminA: '10000000-0000-4000-8000-0000000000a1',
  adminA: '10000000-0000-4000-8000-0000000000a2',
  studentA: '10000000-0000-4000-8000-0000000000a3',
  ownerB: '10000000-0000-4000-8000-00000000000b',
  platformOwner: '10000000-0000-4000-8000-0000000000f0',
  platformSupport: '10000000-0000-4000-8000-0000000000f1',
  invitee: '10000000-0000-4000-8000-0000000000c1',
  unconfirmed: '10000000-0000-4000-8000-0000000000c2',
  stranger: '10000000-0000-4000-8000-0000000000c3',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string

async function addMember(tenant: string, userId: string, roleKey: string) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`,
    [tenant, userId],
  )
  await pool.query(
    `insert into public.membership_roles (tenant_id, membership_id, role_id)
     select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`,
    [tenant, rows[0]!.id, roleKey],
  )
  return rows[0]!.id
}

// Invitations are committed so that the invitee's later transactions can see them.
const invite = (actor: string, slug: string, email: string, role: string, days = 7) =>
  asCommitted(pool, user(actor), (c) => c.query(`select public.create_invitation($1, $2, $3, $4) as inv`, [slug, email, role, days]))

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
       ($1, 'owner@a.example', now(), '{"full_name":"Owner A"}'),
       ($2, 'dept@a.example', now(), '{"full_name":"Dept Admin A"}'),
       ($3, 'student@a.example', now(), '{"full_name":"Student A"}'),
       ($4, 'owner@b.example', now(), '{"full_name":"Owner B"}'),
       ($5, 'root@platform.example', now(), '{"full_name":"Platform Owner"}'),
       ($6, 'support@platform.example', now(), '{"full_name":"Platform Support"}'),
       ($7, 'invitee@new.example', now(), '{"full_name":"Invitee"}'),
       ($8, 'unconfirmed@new.example', null, '{}'),
       ($9, 'stranger@x.example', now(), '{}'),
       ($10, 'admin@a.example', now(), '{"full_name":"Admin A"}')`,
    [U.ownerA, U.deptAdminA, U.studentA, U.ownerB, U.platformOwner, U.platformSupport, U.invitee, U.unconfirmed, U.stranger, U.adminA],
  )
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.ownerA])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  await addMember(tenantA, U.deptAdminA, 'department_admin')
  await addMember(tenantA, U.studentA, 'student')
  await addMember(tenantA, U.adminA, 'university_admin')
  await pool.query(`insert into public.platform_admins (user_id, role) values ($1, 'owner'), ($2, 'support')`, [U.platformOwner, U.platformSupport])
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('invitations: creation and escalation rules', () => {
  it('owner creates an invitation; only the SHA-256 hash is stored', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      const inv = (await c.query(`select public.create_invitation('uni-a', 'New.Person@Example.com', 'admissions_staff') as inv`)).rows[0].inv
      expect(inv.token).toMatch(/^[0-9a-f]{64}$/)
      const stored = (await c.query(`select email, token_hash from public.invitations where id = $1`, [inv.id])).rows[0]
      expect(stored.email).toBe('new.person@example.com')
      expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(stored.token_hash).not.toBe(inv.token)
    })
  })

  it('department admins can invite only into roles within their own permissions', async () => {
    const ok = await invite(U.deptAdminA, 'uni-a', 'learner@a.example', 'student')
    expect(ok.rows[0].inv.token).toMatch(/^[0-9a-f]{64}$/)
    await expect(invite(U.deptAdminA, 'uni-a', 'boss@a.example', 'university_owner')).rejects.toMatchObject({ code: '42501' })
    await expect(invite(U.deptAdminA, 'uni-a', 'adm@a.example', 'admissions_staff')).rejects.toMatchObject({ code: '42501' })
  })

  it('students, other tenants and anonymous callers cannot invite', async () => {
    await expect(invite(U.studentA, 'uni-a', 'x@a.example', 'student')).rejects.toMatchObject({ code: '42501' })
    await expect(invite(U.ownerA, 'uni-b', 'x@b.example', 'student')).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, anon, `select public.create_invitation('uni-a', 'x@a.example', 'student')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('platform owners can invite a university owner (onboarding)', async () => {
    const res = await invite(U.platformOwner, 'uni-b', 'second-owner@b.example', 'university_owner')
    expect(res.rows[0].inv.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects unknown roles, bad emails and invalid validity', async () => {
    await expect(invite(U.ownerA, 'uni-a', 'x@a.example', 'galactic_emperor')).rejects.toMatchObject({ code: '22023' })
    await expect(invite(U.ownerA, 'uni-a', 'not-an-email', 'student')).rejects.toMatchObject({ code: '23514' })
    await expect(invite(U.ownerA, 'uni-a', 'x@a.example', 'student', 90)).rejects.toMatchObject({ code: '22023' })
  })

  it('a new invitation replaces the pending one for the same email', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`select public.create_invitation('uni-a', 'twice@a.example', 'student')`)
      await c.query(`select public.create_invitation('uni-a', 'twice@a.example', 'registrar')`)
      const pending = await c.query(`select public.tenant_invitations('uni-a') as l`)
      const forEmail = pending.rows[0].l.filter((i: { email: string }) => i.email === 'twice@a.example')
      expect(forEmail).toHaveLength(1)
      expect(forEmail[0].role_key).toBe('registrar')
      expect(Object.keys(forEmail[0])).not.toContain('token_hash')
    })
  })
})

describe('invitations: preview and acceptance', () => {
  it('the invited person (confirmed email) accepts and becomes a member with the role', async () => {
    const token = (await invite(U.ownerA, 'uni-a', 'invitee@new.example', 'registrar')).rows[0].inv.token
    await as(pool, user(U.invitee), async (c) => {
      const preview = (await c.query(`select public.invitation_preview($1) as p`, [token])).rows[0].p
      expect(preview).toMatchObject({ tenant_name: 'University A', role_key: 'registrar', status: 'pending', email_matches: true, email_hint: 'i***@new.example' })
      const slug = (await c.query(`select public.accept_invitation($1) as s`, [token])).rows[0].s
      expect(slug).toBe('uni-a')
      const access = (await c.query(`select public.my_tenant_access('uni-a') as a`)).rows[0].a
      expect(access.roles).toEqual(['registrar'])
      await expect(c.query(`select public.accept_invitation($1)`, [token])).rejects.toMatchObject({ code: '22023' })
    })
  })

  it('someone else holding the link cannot accept it', async () => {
    const token = (await invite(U.ownerA, 'uni-a', 'target@new.example', 'student')).rows[0].inv.token
    const preview = (await query(pool, user(U.stranger), `select public.invitation_preview($1) as p`, [token])).rows[0].p
    expect(preview.email_matches).toBe(false)
    await expect(query(pool, user(U.stranger), `select public.accept_invitation($1)`, [token])).rejects.toMatchObject({ code: '42501' })
  })

  it('an unconfirmed email address cannot accept', async () => {
    const token = (await invite(U.ownerA, 'uni-a', 'unconfirmed@new.example', 'student')).rows[0].inv.token
    await expect(query(pool, user(U.unconfirmed), `select public.accept_invitation($1)`, [token])).rejects.toMatchObject({ code: '42501' })
  })

  it('revoked, expired and unknown tokens are refused', async () => {
    const revoked = (await invite(U.ownerA, 'uni-a', 'stranger@x.example', 'student')).rows[0].inv
    await asCommitted(pool, user(U.ownerA), (c) => c.query(`select public.revoke_invitation($1)`, [revoked.id]))
    await expect(query(pool, user(U.stranger), `select public.accept_invitation($1)`, [revoked.token])).rejects.toMatchObject({ code: '22023' })

    const expired = (await invite(U.ownerA, 'uni-a', 'stranger@x.example', 'student')).rows[0].inv
    await pool.query(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [expired.id])
    await expect(query(pool, user(U.stranger), `select public.accept_invitation($1)`, [expired.token])).rejects.toMatchObject({ code: '22023' })

    await expect(query(pool, user(U.stranger), `select public.accept_invitation($1)`, ['f'.repeat(64)])).rejects.toMatchObject({ code: 'P0002' })
    expect((await query(pool, user(U.stranger), `select public.invitation_preview('nonsense') as p`)).rows[0].p).toBeNull()
  })

  it('students cannot list or revoke invitations', async () => {
    await expect(query(pool, user(U.studentA), `select public.tenant_invitations('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    const inv = (await invite(U.ownerA, 'uni-a', 'keep@a.example', 'student')).rows[0].inv
    await expect(query(pool, user(U.studentA), `select public.revoke_invitation($1)`, [inv.id])).rejects.toMatchObject({ code: '42501' })
  })
})

describe('member listing', () => {
  it('owners see their members with emails, only in their tenant', async () => {
    const { rows } = await query(pool, user(U.ownerA), `select public.tenant_members('uni-a') as m`)
    const emails = rows[0].m.map((m: { email: string }) => m.email)
    expect(emails).toContain('student@a.example')
    expect(emails).not.toContain('owner@b.example')
    await expect(query(pool, user(U.ownerA), `select public.tenant_members('uni-b')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('students and platform staff without a grant cannot list members', async () => {
    await expect(query(pool, user(U.studentA), `select public.tenant_members('uni-a')`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.platformOwner), `select public.tenant_members('uni-a')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('a support grant allows read-only member listing', async () => {
    await as(pool, user(U.platformOwner), async (c) => {
      await c.query(
        `insert into public.support_access_grants (tenant_id, grantee_id, reason, granted_by, expires_at)
         values ($1, $2, 'Helping with member onboarding', $2, now() + interval '1 hour')`,
        [tenantA, U.platformOwner],
      )
      const members = (await c.query(`select public.tenant_members('uni-a') as m`)).rows[0].m
      expect(members.length).toBeGreaterThan(0)
    })
  })
})

describe('every university keeps an active owner', () => {
  it('the sole owner cannot remove their owner role or suspend themselves', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      await expect(
        c.query(
          `delete from public.membership_roles mr using public.roles r
           where mr.role_id = r.id and r.key = 'university_owner' and mr.tenant_id = $1`,
          [tenantA],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
    await as(pool, user(U.ownerA), async (c) => {
      await expect(c.query(`update public.tenant_memberships set status = 'suspended' where user_id = $1 and tenant_id = $2`, [U.ownerA, tenantA])).rejects.toMatchObject({
        code: '23514',
      })
    })
  })

  it('ownership can be handed over once another owner exists', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      const deptMembership = (await c.query(`select id from public.tenant_memberships where user_id = $1`, [U.deptAdminA])).rows[0].id
      const ownerRole = (await c.query(`select id from public.roles where tenant_id = $1 and key = 'university_owner'`, [tenantA])).rows[0].id
      await c.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [tenantA, deptMembership, ownerRole])
      const removed = await c.query(
        `delete from public.membership_roles mr using public.tenant_memberships m
         where mr.membership_id = m.id and m.user_id = $1 and mr.role_id = $2`,
        [U.ownerA, ownerRole],
      )
      expect(removed.rowCount).toBe(1)
    })
  })

  it('removing a non-owner role is unaffected, and tenants can still be deleted by the backend', async () => {
    const res = await query(
      pool,
      user(U.ownerA),
      `delete from public.membership_roles mr using public.tenant_memberships m where mr.membership_id = m.id and m.user_id = $1`,
      [U.studentA],
    )
    expect(res.rowCount).toBe(1)
    const temp = (await pool.query(`select public.create_tenant('temp-uni', 'Temporary University', $1) as id`, [U.stranger])).rows[0].id
    const del = await pool.query(`delete from public.tenants where id = $1`, [temp])
    expect(del.rowCount).toBe(1)
  })
})

describe('ownership is reserved to owners (migration 7)', () => {
  const ownerRoleId = async () =>
    (await pool.query(`select id from public.roles where tenant_id = $1 and key = 'university_owner'`, [tenantA])).rows[0].id as string
  const membershipOf = async (userId: string) =>
    (await pool.query(`select id from public.tenant_memberships where tenant_id = $1 and user_id = $2`, [tenantA, userId])).rows[0].id as string

  it('a university admin cannot make themselves owner, directly or by invitation', async () => {
    const [role, membership] = [await ownerRoleId(), await membershipOf(U.adminA)]
    await expect(
      query(pool, user(U.adminA), `insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [tenantA, membership, role]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(invite(U.adminA, 'uni-a', 'new-owner@a.example', 'university_owner')).rejects.toMatchObject({ code: '42501' })
  })

  it('a university admin cannot suspend, remove or demote an owner', async () => {
    const ownerMembership = await membershipOf(U.ownerA)
    await as(pool, user(U.ownerA), async (c) => {
      // Even with a second owner present (so the last-owner guard would not trigger).
      await c.query(`insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [tenantA, await membershipOf(U.deptAdminA), await ownerRoleId()])
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.adminA, role: 'authenticated' })])
      await expect(c.query(`update public.tenant_memberships set status = 'suspended' where id = $1`, [ownerMembership])).rejects.toMatchObject({ code: '42501' })
    })
    await expect(query(pool, user(U.adminA), `delete from public.tenant_memberships where id = $1`, [ownerMembership])).rejects.toMatchObject({ code: '42501' })
    await expect(
      query(pool, user(U.adminA), `delete from public.membership_roles where membership_id = $1 and role_id = $2`, [ownerMembership, await ownerRoleId()]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('a university admin can still manage everyone else', async () => {
    const studentMembership = await membershipOf(U.studentA)
    const res = await query(pool, user(U.adminA), `update public.tenant_memberships set status = 'suspended' where id = $1`, [studentMembership])
    expect(res.rowCount).toBe(1)
    const inv = await invite(U.adminA, 'uni-a', 'staff@a.example', 'registrar')
    expect(inv.rows[0].inv.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('owners add owners directly; platform owners onboard owners by invitation only (ADR-014)', async () => {
    const [role, membership] = [await ownerRoleId(), await membershipOf(U.adminA)]
    const res = await query(pool, user(U.ownerA), `insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [tenantA, membership, role])
    expect(res.rowCount).toBe(1)
    await expect(
      query(pool, user(U.platformOwner), `insert into public.membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`, [tenantA, membership, role]),
    ).rejects.toMatchObject({ code: '42501' })
    const inv = await invite(U.platformOwner, 'uni-a', 'co-owner@a.example', 'university_owner')
    expect(inv.rows[0].inv.token).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('tenant profile and branding', () => {
  it('owners update display names, language and time zone; students cannot', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`select public.update_tenant_profile('uni-a', '{"en":"University A","ar":"جامعة أ"}', 'ar', 'Africa/Cairo')`)
      const t = (await c.query(`select default_locale, timezone, name_translations ->> 'ar' as ar from public.tenants where id = $1`, [tenantA])).rows[0]
      expect(t).toEqual({ default_locale: 'ar', timezone: 'Africa/Cairo', ar: 'جامعة أ' })
    })
    await expect(query(pool, user(U.studentA), `select public.update_tenant_profile('uni-a', '{}', 'en', 'UTC')`)).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects invalid profile values', async () => {
    await expect(query(pool, user(U.ownerA), `select public.update_tenant_profile('uni-a', '["x"]', 'en', 'UTC')`)).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.ownerA), `select public.update_tenant_profile('uni-a', '{"fr":"x"}', 'en', 'UTC')`)).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.ownerA), `select public.update_tenant_profile('uni-a', '{}', 'en', 'Mars/Base')`)).rejects.toMatchObject({ code: '22023' })
    await expect(query(pool, user(U.ownerA), `select public.update_tenant_profile('uni-a', '{}', 'fr', 'UTC')`)).rejects.toMatchObject({ code: '23514' })
  })

  it('draft branding is published by the caller only after validation', async () => {
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`update public.tenant_branding set draft = '{"primary":"#0f766e","assistant_name":"A Bot"}' where tenant_id = $1`, [tenantA])
      await c.query(`select public.publish_branding('uni-a')`)
      const b = (await c.query(`select published, draft, published_by from public.tenant_branding where tenant_id = $1`, [tenantA])).rows[0]
      expect(b).toEqual({ published: { primary: '#0f766e', assistant_name: 'A Bot' }, draft: null, published_by: U.ownerA })
      await expect(
        c.query(`update public.tenant_branding set draft = '{"logo_path":"../../etc/passwd"}' where tenant_id = $1`, [tenantA]),
      ).rejects.toMatchObject({ code: '23514' })
    })
    await expect(query(pool, user(U.studentA), `select public.publish_branding('uni-a')`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('platform functions', () => {
  it('platform staff get tenant overviews with aggregate counts only', async () => {
    const { rows } = await query(pool, user(U.platformSupport), `select public.platform_tenants() as t`)
    const a = rows[0].t.find((t: { slug: string }) => t.slug === 'uni-a')
    expect(a.member_count).toBeGreaterThan(0)
    expect(Object.keys(a)).not.toContain('members')
    await expect(query(pool, user(U.ownerA), `select public.platform_tenants()`)).rejects.toMatchObject({ code: '42501' })
  })

  it('only platform owners/admins see the staff directory', async () => {
    const staff = (await query(pool, user(U.platformOwner), `select public.platform_staff() as s`)).rows[0].s
    expect(staff.map((s: { email: string }) => s.email)).toEqual(['root@platform.example', 'support@platform.example'])
    await expect(query(pool, user(U.platformSupport), `select public.platform_staff()`)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('T16 · tenant-scoped storage for brand assets', () => {
  const upload = (actor: string, path: string, bucket = 'tenant-assets') =>
    query(pool, user(actor), `insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)`, [bucket, path, actor])

  it('branding managers can upload only into their own tenant folder', async () => {
    await expect(upload(U.ownerA, `${tenantA}/logo.png`)).resolves.toBeTruthy()
    await expect(upload(U.ownerA, `${tenantB}/logo.png`)).rejects.toMatchObject({ code: '42501' })
  })

  it('students, malformed paths and other buckets are refused', async () => {
    await expect(upload(U.studentA, `${tenantA}/logo.png`)).rejects.toMatchObject({ code: '42501' })
    await expect(upload(U.ownerA, `logo.png`)).rejects.toMatchObject({ code: '42501' })
    await expect(upload(U.ownerA, `not-a-uuid/logo.png`)).rejects.toMatchObject({ code: '42501' })
  })

  it('objects of one tenant are not listable by another tenant', async () => {
    await pool.query(`insert into storage.objects (bucket_id, name) values ('tenant-assets', $1)`, [`${tenantA}/existing.png`])
    const own = await query(pool, user(U.ownerA), `select name from storage.objects`)
    const other = await query(pool, user(U.ownerB), `select name from storage.objects`)
    expect(own.rows.map((r) => r.name)).toContain(`${tenantA}/existing.png`)
    expect(other.rows).toEqual([])
  })

  it('the bucket rejects SVG and large files by configuration', async () => {
    const b = (await pool.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'tenant-assets'`)).rows[0]
    expect(b).toEqual({ public: true, file_size_limit: '1048576', allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] })
  })
})
