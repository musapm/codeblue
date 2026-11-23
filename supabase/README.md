# Database (Supabase project "agent")

| Item | Value |
| --- | --- |
| Project | `agent` · ref `zijruhuvzxtuudsvnwgy` · `https://zijruhuvzxtuudsvnwgy.supabase.co` |
| Region | eu-central-1 (Frankfurt), permanent |
| Plan | Free (no backups). **Upgrade before any real university data** |

## Layout

```
supabase/
  migrations/   SQL migrations — the single source of truth for the schema (applied in order)
  seed/         demo data + one-time bootstrap scripts (run manually, never automatically in prod)
  tests/        tenant-isolation / RLS test suite (runs on plain PostgreSQL with a Supabase shim)
```

Migration file versions match the versions recorded in the project
(`supabase_migrations.schema_migrations`), so the Supabase CLI sees them as already applied.

| Migration | Contents |
| --- | --- |
| `20261121200204_foundation.sql` | `app` private schema, enums, identity + tenancy tables, composite same-tenant FKs, RLS enabled everywhere, least-privilege grants, append-only audit table |
| `20261121200228_catalog.sql` | 35 permissions, 15 features, 13 system role templates |
| `20261121200313_access_policies.sql` | `app.*` access helpers (SECURITY DEFINER, caller-scoped) and every RLS policy |
| `20261121200345_auth_hooks_and_rpc.sql` | profile-on-signup trigger; API functions `create_tenant`, `my_workspaces`, `my_tenant_access`, `my_platform_role` |
| `20261121200323_audit.sql` | database-enforced audit triggers on all access/configuration tables |
| `20261122105259_management.sql` | Phase 3: invitations (`create_invitation`, `invitation_preview`, `accept_invitation`, `tenant_invitations`, `revoke_invitation`), `tenant_members`, `update_tenant_profile`, `publish_branding`, `platform_tenants`, `platform_staff`; last-owner guard; `tenant-assets` storage bucket + per-tenant policies; `department_admin` gains `academic.use` |
| `20261122105537_owner_protection.sql` | Phase 3: only owners (or platform owners/admins) change ownership (ADR-018) |
| `20261123090000_knowledge.sql` | Phase 4: knowledge base (documents, versions, chunks, access lists, search_knowledge, `tenant-documents` bucket). **Not yet applied to "agent"**; the file will be renamed to the recorded version after applying |

## Rules for new migrations

1. Every new table: `tenant_id` (if tenant-owned), composite `(tenant_id, id)` FKs for children,
   `enable row level security`, explicit policies `to authenticated`, `revoke all … from anon`.
2. Add isolation tests in `tests/rls.test.ts` (foundation) or `tests/management.test.ts` (Phase 3) in the same change.
3. Apply to the dev project, re-run security advisors (must be clean except documented items),
   regenerate `src/lib/supabase/database.types.ts`.

## Running the isolation tests

```bash
# any disposable PostgreSQL 15+ superuser connection (creates and drops a temp database)
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:db
```

## Seeds

- `seed/demo_northbridge.sql` — fictional demo university (idempotent; applied to "agent").
- `seed/bootstrap_platform_owner.sql` — make yourself the first platform owner after signing up
  (replace the email; run once in the SQL editor). There is intentionally no way to become
  platform owner through the app or API.

## Accepted advisor findings

| Finding | Why it is accepted |
| --- | --- |
| `authenticated` can execute SECURITY DEFINER `create_tenant`, `my_workspaces`, `my_tenant_access`, `my_platform_role` and the Phase 3 functions (`create_invitation`, `invitation_preview`, `accept_invitation`, `tenant_invitations`, `revoke_invitation`, `tenant_members`, `update_tenant_profile`, `publish_branding`, `platform_tenants`, `platform_staff`) | They are the API. `my_*` and `invitation_preview` only describe the caller; every other function checks permissions itself (tested in `tests/management.test.ts`). `anon` cannot execute any of them. |
| Public bucket `tenant-assets` | Logos must load for students without a session. Writes/listing require `tenant.branding.manage` for the folder's tenant (T16); 1 MB limit; PNG/JPEG/WebP only. |
| RLS enabled without policies on `app.role_templates`, `app.role_template_permissions` | Intentional deny-all; private schema, not exposed through the Data API. |
