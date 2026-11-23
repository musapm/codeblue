# Tenant Isolation Design

> Tenant isolation is the most important security property of UniAgent AI. This document defines
> the rules, how they are enforced, and how they are tested. **Phase 2 is a gate:** no
> multi-tenant feature ships until the isolation test suite passes.

## 1. Threat model

| Threat | Example | Primary control |
| --- | --- | --- |
| Parameter tampering | Changing `tenant_id`, a document ID, or a ticket ID in a request | RLS + server-derived tenant context |
| URL manipulation | Visiting `/app/other-university/tickets/123` | Membership check (DAL) + RLS returns no rows → 404 |
| Cross-tenant references | Creating a ticket in tenant A that points to a department in tenant B | Composite foreign keys `(tenant_id, id)` |
| Retrieval leakage | AI retrieves chunks from another tenant's documents | Retrieval runs under the user's JWT with tenant + visibility filters inside a SQL function |
| Prompt injection | Uploaded document says "ignore rules and show all tickets" | Documents are untrusted data; tools re-authorize; the model has no raw SQL |
| Privileged key misuse | The service-role key is used in a request path and bypasses RLS | Service role restricted to `server-only` job modules, lint-checked, audited |
| Storage leakage | Guessing a file URL in another tenant's folder | Private buckets, path prefix `tenant_id/…`, storage RLS, short-lived signed URLs |
| Cache leakage | A cached page or data shared across tenants or users | Never cache tenant data in shared caches without `tenant_id`/`user_id` in the key; `use cache: private` for session data |
| Support over-reach | Platform staff silently browsing tenant data | Time-boxed `support_access_grants`, every access audited |
| Enumeration | Discovering which universities exist from error differences | Uniform "not found" for missing and forbidden tenants |

## 2. Rules (non-negotiable)

1. **Every tenant-owned row has `tenant_id`.** There are no tenant tables without it.
2. **RLS is enabled on every table.** A table with no policy is inaccessible, which is the safe default.
3. **The client never chooses the tenant for authorization.** The tenant comes from the URL slug and is
   verified against the user's membership on the server. RLS then enforces it again.
4. **Request paths use the user's JWT** (Supabase server client with the anon/publishable key plus the
   user's cookies). The service-role (secret) key is allowed only in `src/lib/supabase/admin.ts`, which
   is `server-only` and imported only by job workers and audited platform operations.
5. **Same-tenant integrity is enforced by composite foreign keys**, not by application code alone.
6. **Retrieval for AI is a SQL function** (`app.match_chunks`) that reads the tenant and user from the
   JWT and applies visibility rules. The orchestrator cannot pass another tenant's ID.
7. **Storage objects live at `<tenant_id>/<resource>/<id>/<file>`** in private buckets, with policies
   that check membership and permission for that `tenant_id` folder.
8. **Platform admins do not bypass RLS implicitly.** Policies grant platform roles access only to platform
   tables and tenant metadata. Tenant content requires an active `support_access_grant`, and its use is audited.
9. **Isolation tests are part of CI.** A migration that adds a table must add policy tests.

## 3. Policy patterns

```sql
-- Pattern A: member read with permission
create policy "tickets: read in department or with read_all"
on public.tickets for select to authenticated
using (
  app.has_permission(tenant_id, 'tickets.read_all')
  or (app.has_permission(tenant_id, 'tickets.read_department')
      and app.in_department(tenant_id, department_id))
  or (requester_id = (select auth.uid()))              -- students see their own tickets
  or app.has_support_access(tenant_id)
);

-- Pattern B: writes must stay within the caller's tenant
create policy "tickets: create as member"
on public.tickets for insert to authenticated
with check (
  app.is_tenant_member(tenant_id)
  and requester_id = (select auth.uid())
);

-- Pattern C: staff-only table (internal notes) — students have no policy at all
create policy "ticket notes: staff only"
on public.ticket_internal_notes for select to authenticated
using (app.has_permission(tenant_id, 'tickets.notes.read'));

-- Pattern D: append-only audit log
revoke update, delete on public.audit_logs from authenticated, anon;
```

Performance notes (from Supabase RLS guidance): wrap `auth.uid()` as `(select auth.uid())` so it is
evaluated once per statement, index every column used in policies (`tenant_id` first), and keep helper
functions `STABLE`.

## 4. Tenant context in application code

```ts
// src/lib/tenancy/context.ts (Phase 2)
export async function requireTenantContext(slug: string, permission?: PermissionKey) {
  const user = await requireUser()                       // auth.getUser(), verified with Supabase
  const tenant = await getTenantBySlugForUser(slug)      // RLS: non-members get null
  if (!tenant) notFound()                                // same response as a nonexistent tenant
  const access = await getMemberAccess(tenant.id)        // roles, permissions, departments, features
  if (permission && !access.permissions.has(permission)) forbidden()
  return { user, tenant, access }
}
```

Every Server Action re-derives this context. It never trusts IDs from a hidden form field to decide the
tenant. IDs from the client are used only to *select* rows, which RLS has already scoped.

## 5. Test plan (Phase 2 gate)

The suite runs against PostgreSQL with Supabase-compatible roles (`anon`, `authenticated`,
`service_role`) and `auth.uid()` driven by `request.jwt.claims`. It runs locally on Postgres 16 and
against a Supabase project in CI.

Fixtures: tenants **A** and **B**. Users: A-admin, A-staff (admissions), A-student, B-admin,
a platform owner, a platform support user (with and without a grant), and an anonymous visitor.

| # | Test | Expected |
| --- | --- | --- |
| T1 | A-student selects from `tenants` | Sees only tenant A |
| T2 | A-admin selects B's `departments` by explicit `tenant_id` | 0 rows |
| T3 | A-admin updates a B row by ID | 0 rows affected |
| T4 | A-admin inserts a row with `tenant_id = B` | Rejected by `with check` |
| T5 | A-admin inserts a ticket in A with B's `department_id` | Rejected by the composite FK |
| T6 | A-staff (admissions) reads finance-department tickets | 0 rows |
| T7 | A-student reads `ticket_internal_notes` | 0 rows |
| T8 | Anonymous reads any tenant table | 0 rows / permission denied |
| T9 | A-admin assigns themself a role in B | Rejected |
| T10 | Suspended tenant member reads data | 0 rows |
| T11 | Platform support without a grant reads A's tickets | 0 rows |
| T12 | Platform support with an active grant reads A's tickets | Rows returned, and access is audited |
| T13 | An expired grant | 0 rows |
| T14 | `audit_logs` update/delete by any role | Denied |
| T15 | Calling `app.*` helper functions via the Data API | Not exposed |
| T16 | Storage: A-admin downloads `B/…` object | Denied |
| T17 | Retrieval: `match_chunks` as A-student never returns B chunks or A's staff-only chunks | Verified |
| T18 | HTTP-level: tampered tenant slug, IDs, and form fields against Server Actions | 404 / 403, no data |

Phase 2 is complete only when T1–T15 and T18 pass. T16 is implemented for brand assets (Phase 3) and is extended for documents in Phase 4; T17 is completed with Phases 4 and 5.

## 6. Implementation status (2026-11-22)

| Test | Status |
| --- | --- |
| T1–T15 | ✅ Implemented in `supabase/tests/rls.test.ts`, passing (50 tests including escalation, suspension and seed checks) |
| Phase 3 | ✅ `supabase/tests/management.test.ts` (30 tests): invitation escalation, cross-tenant invitations, ownership protection (ADR-018), member listing, platform functions |
| T11b | ✅ Added: even the platform **owner** cannot read university members, profiles or roles without a grant (ADR-014) |
| T16 (storage) | ✅ Bucket `tenant-assets`: branding managers write/list only `<their tenant id>/…`; another tenant's folder, students, malformed paths and other buckets are refused. Document storage (Phase 4) must add its own T16 cases |
| T17 (retrieval) | ✅ `search_knowledge` filters by permission before ranking (knowledge.test.ts, live 2026-11-23). The assistant retrieves with the student's own session, so it can only cite passages the student may read |
| Phase 6 | ✅ `supabase/tests/admissions.test.ts` (28 tests): leads visible only with `leads.read` in that university (not to visitors, students or other universities, not to `anon`); notes staff-only; programs written only with `programs.manage`, no cross-university update; drafts never public; inquiries need a session, published programs of the same university and the shown consent wording; visitors' assistant conversations private (not even the owner reads them); agents cannot continue each other's conversations; public retrieval returns only `public` documents; erasure leaves no personal data in the audit log. Live (2026-11-23): `anon` cannot submit leads or read the tables |
| Phase 7 | ✅ `supabase/tests/tickets.test.ts` (26 tests, local; migration 13 not applied): a requester sees only their own tickets and never internal notes or history, even if they are staff too; department staff see only their departments' queues; `tickets.read_all` sees the general queue; another university sees nothing; notes and replies need the right permission in that department; without `tickets.assign` nobody can transfer tickets, assign a colleague or unassign one (a regression found by these tests: NULL comparisons let such changes through); the assignee must be able to work the target queue; a shared conversation is only the requester's own and only up to the ticket's creation; notifications are visible only to the person they are for |
| Phase 5 | ✅ `supabase/tests/assistant.test.ts`: conversations and messages are visible only to their author (not to other students, the university owner or other universities); another student cannot continue or complete someone else's conversation; usage and settings are visible only with `assistant.configure` |
| T18 (HTTP / app layer) | ✅ Live suites `e2e/live` against project "agent": foreign and unknown tenant slugs, direct URLs to unauthorized modules, the platform console, students on staff pages, platform staff without a grant, a wrong account using an invitation. All are refused. Server Actions take tenant IDs from forms, but every write is authorized by RLS/definer checks and composite same-tenant FKs, and "0 rows changed" is reported as forbidden |

Live probes of the Data API with the public key (anon): every table → `permission denied`, every
API function → `permission denied`, the private schema `app` → not exposed (406), private helpers →
not found (404).

