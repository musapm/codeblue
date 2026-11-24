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
| `20261123100613_knowledge.sql` | Phase 4: knowledge base (documents, versions, chunks, access lists, search_knowledge, `tenant-documents` bucket) |
| `20261123121337_knowledge_file_cleanup.sql` | Phase 4: managers may see files of deleted documents so they can be removed (fix found by the live test) |
| `20261123124604_assistant.sql` | Phase 5: assistant settings, conversations, messages, feedback, `ai_usage_events`, budget helper and the `assistant_*` functions. Applied 2026-11-23, byte-identical (MD5 `dcf15abd…`, 18,788 bytes) |
| `20261123151820_admissions.sql` | Phase 6: admissions settings, programs, consented leads with notes and history, public page function, visitor inquiries and admissions assistant turns (anonymous sessions), per-agent AI budgets, analytics; assistant conversations gain an `agent` column. Applied 2026-11-23, byte-identical (MD5 `46d73168…`, 54,907 bytes) |
| `20261124100000_admissions_maintenance.sql` | Phase 6: `admissions_export_lead` (audited export of one inquiry for access requests) and `app.cleanup_anonymous_visitors(days)`. **Written and tested locally; not applied yet** (its version number will change to the one Supabase records) |
| `20261124120000_tickets.sql` | Phase 7: ticket categories (routing), tickets, public thread, internal notes (requester never reads them), history, in-app notifications, ticket AI gate and usage, the `tickets_*`, `my_notifications` and `notifications_mark_read` functions (ADR-027). **Written and tested locally (26 DB tests); not applied yet** (its version number will change to the one Supabase records) |
| `20261124140000_analytics.sql` | Phase 8: `analytics_overview`, the AI quality functions (`quality_gaps`, `quality_flagged`, `quality_summary`, `quality_review_save`, `quality_review_reopen`), `ai_quality_reviews`, redaction and visibility helpers, period indexes (ADR-028). **Written and tested locally (25 DB tests); not applied yet** |
| `20261124160000_academic.sql` | Phase 9: Faculty member role; courses, enrollment with join codes, course materials in the knowledge pipeline (`course_id`), academic settings, private study aids with server-side quiz grading, class figures; replaces `can_read_knowledge`, `can_manage_knowledge`, `search_knowledge`, `analytics_overview` and the storage delete rule (ADR-029). **Written and tested locally (28 DB tests); not applied yet** |
| `20261124180000_staff.sql` | Phase 10: staff assistant settings and private drafts, `staff` conversations, the staff gate (switch, budget, daily limit), drafting and ticket-digest functions (`staff_*`), `search_knowledge` with a department filter, staff usage in `assistant_complete_turn` and `analytics_overview` (ADR-030). **Written and tested locally (16 DB tests); not applied yet** |
| `20261124200000_workflows.sql` | Phase 11: versioned request forms (drafts, immutable published versions), requests with tracking numbers, answers checked against their version, the status flow, comments and internal notes, request notifications (`notifications.request_id`, `my_notifications` replaced), the form-suggestion gate and settings, workflow counts and cost in `analytics_overview` (ADR-031). **Written and tested locally (20 DB tests); not applied yet** |

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
| `search_knowledge` and the `knowledge_*` functions (Phase 4) | Same pattern: each checks `app.can_manage_knowledge` / membership itself; reads go through RLS (`app.can_read_knowledge`). Covered by `tests/knowledge.test.ts`. |
| Public bucket `tenant-assets` | Logos must load for students without a session. Writes/listing require `tenant.branding.manage` for the folder's tenant (T16); 1 MB limit; PNG/JPEG/WebP only. |
| RLS enabled without policies on `app.role_templates`, `app.role_template_permissions`, `app.admission_lead_counters` | Intentional deny-all; private schema, not exposed through the Data API. |
| `assistant_*` and `admissions_*` functions (Phases 5–6) | The API. Each checks membership, permissions, the feature and the university's switches itself; visitor functions accept any session (anonymous included) and enforce per-visitor limits. Covered by `tests/assistant.test.ts` and `tests/admissions.test.ts`. |
| `anon` can execute SECURITY DEFINER `public_admissions` (Phase 6) | Intentional: the public admissions page must load without a session. It returns only published programs and public settings of universities that published their page, and `null` otherwise (no difference between unknown and unpublished). |

## Scheduled cleanup of anonymous visitors (after migration 12)

Anonymous visitor accounts (ADR-025) accumulate. Once migration 12 is applied, enable the `pg_cron`
extension (Database → Extensions) and schedule the cleanup in the SQL editor:

```sql
select cron.schedule('cleanup-anonymous-visitors', '17 3 * * *', $$select app.cleanup_anonymous_visitors(30)$$);
```

It removes anonymous accounts created more than 30 days ago and unused since. Their assistant
conversations go with them; inquiries stay (without the visitor link) and AI cost records stay.
To be verified on the live project: that the migration role may delete from `auth.users` (Supabase
documents this deletion for anonymous users; the local tests use a shim).
