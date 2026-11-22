# Database Architecture

> Status: **Phase 2 tables are implemented** in `supabase/migrations/` and applied to project "agent"
> (see `supabase/README.md`). The SQL in the migrations is authoritative; the sketch below is the design.
> Differences from the sketch: `slug` and `email` columns are `text` with format checks (no `citext`);
> `features` + `tenant_features` were added now (ADR-017); role templates live in the private `app` schema;
> `audit_logs.tenant_id` has no FK, so history survives deletions. `platform_inquiries` is not built yet.
> Later-phase tables are listed to show that the design accommodates them.
> Later-phase tables are listed to show that the design accommodates them.

## 1. Conventions

- **PostgreSQL 15+ on Supabase.** All application tables live in `public`. Security helper functions
  live in a private schema `app` that is **not exposed** through the Supabase Data API.
- **Primary keys:** `uuid` (`gen_random_uuid()`).
- **Tenant key:** every tenant-owned table has `tenant_id uuid not null references tenants(id)`
  plus an index starting with `tenant_id`.
- **Same-tenant references:** child tables reference parents with **composite foreign keys**
  `(tenant_id, parent_id) → parent(tenant_id, id)`. The database then refuses, for example, a ticket in
  tenant A that points at a department in tenant B, even if application code has a bug.
  Parent tables declare `unique (tenant_id, id)` to allow this.
- **Timestamps:** `created_at timestamptz default now()`, `updated_at` maintained by trigger.
- **Soft deletion** where history matters (`archived_at`). Hard deletion is available for privacy
  requests and documents, through audited procedures.
- **Enums** as Postgres enums for stable sets (statuses), and lookup tables for configurable sets
  (roles, categories).
- **RLS is enabled on every table** in `public`, with no exceptions. Tables with no policy deny all access.
- **Money** in integer minor units, with costs stored in **micro-USD** (`bigint`) to avoid float errors.

## 2. Phase 2 — identity, tenancy, and security foundation

```sql
-- Tenants (universities)
create type tenant_status as enum ('trial', 'active', 'suspended', 'archived');

create table tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            citext not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  name            text not null,
  status          tenant_status not null default 'trial',
  default_locale  text not null default 'en' check (default_locale in ('en','ar')),
  timezone        text not null default 'UTC',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

-- Branding with draft/published versions (published is what users see)
create table tenant_branding (
  tenant_id     uuid primary key references tenants(id) on delete cascade,
  published     jsonb not null default '{}',   -- validated by app + check constraints
  draft         jsonb,
  published_at  timestamptz,
  published_by  uuid references auth.users(id)
);

create table tenant_settings (
  tenant_id            uuid primary key references tenants(id) on delete cascade,
  allowed_signup_domains text[] not null default '{}', -- e.g. {'student.northbridge.edu'}
  self_signup_enabled  boolean not null default false,
  support_email        text,
  settings             jsonb not null default '{}'
);

create table tenant_domains (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  hostname    citext not null unique,
  is_primary  boolean not null default false,
  verified_at timestamptz
);

-- Users: auth.users is managed by Supabase; profiles hold app fields
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_path text,
  locale      text not null default 'en',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Platform-level staff (the platform owner and support team)
create type platform_role as enum ('owner', 'admin', 'support', 'billing');
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       platform_role not null,
  created_at timestamptz not null default now()
);

-- Tenant membership
create type membership_status as enum ('invited', 'active', 'suspended');
create table tenant_memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     membership_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, id)
);

-- Permission catalog (seeded from src/lib/permissions/catalog.ts)
create table permissions (
  key         text primary key,            -- e.g. 'tickets.read_department'
  description text not null,
  category    text not null
);

-- Roles: per-tenant; system templates are copied into each tenant on creation
create table roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  key         text not null,               -- 'university_admin', 'registrar', custom…
  name        text not null,
  description text,
  is_system   boolean not null default false, -- system roles cannot be deleted
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table role_permissions (
  tenant_id      uuid not null,
  role_id        uuid not null,
  permission_key text not null references permissions(key),
  primary key (role_id, permission_key),
  foreign key (tenant_id, role_id) references roles(tenant_id, id) on delete cascade
);

create table membership_roles (
  tenant_id     uuid not null,
  membership_id uuid not null,
  role_id       uuid not null,
  primary key (membership_id, role_id),
  foreign key (tenant_id, membership_id) references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id) references roles(tenant_id, id) on delete cascade
);

create table departments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  slug       text not null,
  name       jsonb not null,               -- {"en": "Admissions", "ar": "القبول"}
  email      text,
  archived_at timestamptz,
  unique (tenant_id, slug),
  unique (tenant_id, id)
);

-- Department scoping for staff (e.g. admissions staff see admissions tickets only)
create table membership_departments (
  tenant_id     uuid not null,
  membership_id uuid not null,
  department_id uuid not null,
  primary key (membership_id, department_id),
  foreign key (tenant_id, membership_id) references tenant_memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments(tenant_id, id) on delete cascade
);

create table invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       citext not null,
  role_id     uuid not null,
  token_hash  text not null unique,        -- SHA-256 of the token; the raw token is emailed only
  invited_by  uuid not null references auth.users(id),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  foreign key (tenant_id, role_id) references roles(tenant_id, id)
);

-- Break-glass support access for platform staff: time-boxed, reasoned, audited
create table support_access_grants (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  grantee_id   uuid not null references auth.users(id),
  reason       text not null check (length(reason) >= 10),
  scope        text not null default 'read' check (scope in ('read','read_write')),
  approved_by  uuid references auth.users(id),     -- tenant admin approval (optional policy)
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz not null check (expires_at <= starts_at + interval '24 hours'),
  revoked_at   timestamptz
);

-- Append-only audit log
create table audit_logs (
  id            bigint generated always as identity primary key,
  tenant_id     uuid references tenants(id),      -- null = platform-level event
  actor_id      uuid references auth.users(id),
  actor_type    text not null check (actor_type in ('user','platform_admin','support','system','ai')),
  action        text not null,                     -- 'member.role_changed', 'document.deleted', …
  target_type   text,
  target_id     text,
  metadata      jsonb not null default '{}',       -- never secrets or raw personal data
  request_id    text,
  ip_hash       text,                              -- salted hash, not the raw IP
  created_at    timestamptz not null default now()
);
```

### Security helper functions (schema `app`, not exposed via the API)

```sql
-- All are STABLE, SECURITY DEFINER, `set search_path = ''`, and use (select auth.uid()).
app.current_user_id() returns uuid
app.is_platform_admin(roles platform_role[] default null) returns boolean
app.is_tenant_member(p_tenant uuid) returns boolean          -- active membership
app.has_permission(p_tenant uuid, p_permission text) returns boolean
app.in_department(p_tenant uuid, p_department uuid) returns boolean
app.has_support_access(p_tenant uuid, p_scope text default 'read') returns boolean
app.tenant_has_feature(p_tenant uuid, p_feature text) returns boolean   -- Phase 3
app.write_audit(…) returns void                                         -- used by RPCs/triggers
```

`has_permission` also returns false when the tenant is `suspended` or `archived`, except for
platform admins and the support read scope. Suspending a tenant therefore immediately blocks its
users at the database level.

## 3. Phase 3 / 15 — plans, features, subscriptions

```
features            (key pk, name, description, category)             -- catalog
plans               (id, key, name, description, is_active, limits jsonb, sort_order)
plan_features       (plan_id, feature_key)
plan_prices         (plan_id, currency, amount_minor, interval, effective_from)  -- no hardcoded prices
tenant_subscriptions(id, tenant_id, plan_id, status [trial|active|past_due|suspended|expired|cancelled],
                     starts_at, ends_at, renews_at, trial_ends_at, payment_status, billing_notes)
tenant_feature_overrides (tenant_id, feature_key, enabled, reason, set_by, set_at)
tenant_limits       (tenant_id, key, value)                            -- overrides plan limits
payment_records     (id, tenant_id, amount_minor, currency, method, reference, recorded_by, paid_at)
platform_settings   (singleton: branding jsonb, defaults jsonb)
```

Effective features = plan features + enabled overrides − disabled overrides, computed by
`app.tenant_has_feature()` and checked server-side on every gated action.

## 4. Later phases (outline)

| Phase | Tables |
| --- | --- |
| 4 Knowledge | `documents` (tenant, title, department, category, visibility, status, version, effective/expiry dates, authoritative flag, source_url, storage_path, checksum), `document_versions`, `document_access` (role/department grants), `document_chunks` (tenant_id, document_id, ordinal, page, content, tsv tsvector, embedding vector(n), embedding_model, token_count), `jobs` (queue), `knowledge_categories` |
| 5 Chat | `conversations` (tenant, user, agent, title, channel), `messages` (role, content, model, tokens, latency), `message_citations` (message_id, chunk_id, document_id, page), `message_feedback` (rating enum, comment), `ai_usage_events`, `unanswered_questions` |
| 6 Admissions | `programs`, `program_requirements`, `leads` (consent fields, source, stage, assigned_to), `lead_notes`, `lead_events` |
| 7 Tickets | `ticket_categories`, `tickets` (number per tenant, status, priority, department, assignee, conversation_id, ai_summary), `ticket_messages` (public replies), `ticket_internal_notes` (separate table, staff-only RLS), `ticket_attachments`, `ticket_events`, `assignment_rules` |
| 8 Analytics | `daily_tenant_metrics` (rollups computed from events; no fabricated numbers) |
| 9 Academic | `courses`, `course_materials`, `quizzes`, `quiz_questions`, `quiz_attempts`, `topic_mastery` |
| 11 Workflows | `workflow_definitions` (versioned JSON schema of steps/fields), `workflow_requests`, `workflow_request_events` |
| 12 Campus | `campus_locations` (type, coordinates, hours jsonb, accessibility jsonb), `location_aliases` |
| 13 Voice | `voice_sessions`, usage in `ai_usage_events` with `modality = 'voice'` |
| 14 Integrations & notifications | `integrations` (tenant, provider, status, config), `integration_secrets` (Supabase Vault references only), `integration_logs`, `notifications`, `notification_preferences`, `outbound_messages` |
| 23 Cost control | `model_prices` (provider, model, unit prices, effective_from), `tenant_ai_budgets`, `usage_counters` (tenant, period, requests, tokens, cost_micros) |

## 5. Data retention (initial policy, configurable per tenant)

| Data | Default retention |
| --- | --- |
| Conversations/messages | 12 months, then deleted (tenant-configurable) |
| Anonymous visitor conversations | 30 days |
| Leads without consent | Not stored |
| Audit logs | 24 months minimum (append-only) |
| AI usage events | 24 months (needed for billing disputes) |
| Deleted documents | Chunks and embeddings deleted immediately; file removed from storage |

## 6. Migrations workflow

- Migrations are plain SQL in `supabase/migrations/<timestamp>_<name>.sql`, applied with the Supabase CLI
  (or the Supabase MCP `apply_migration` in this environment) to a **development project first**.
- Every migration that adds a table must also add RLS policies and isolation tests in the same PR.
- Generated TypeScript types (`supabase gen types`) are committed to `src/lib/supabase/database.types.ts`.
