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

## Rules for new migrations

1. Every new table: `tenant_id` (if tenant-owned), composite `(tenant_id, id)` FKs for children,
   `enable row level security`, explicit policies `to authenticated`, `revoke all … from anon`.
2. Add isolation tests in `tests/rls.test.ts` in the same change.
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
| `authenticated` can execute SECURITY DEFINER `create_tenant`, `my_workspaces`, `my_tenant_access`, `my_platform_role` | They are the API. `my_*` only return data about the caller; `create_tenant` checks platform-owner/admin itself. `anon` cannot execute any of them. |
| RLS enabled without policies on `app.role_templates`, `app.role_template_permissions` | Intentional deny-all; private schema, not exposed through the Data API. |
