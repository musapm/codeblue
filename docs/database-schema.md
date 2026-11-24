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

## 2b. Phase 3 — university management (implemented, migrations 6–7)

No new tables. New API functions (SECURITY DEFINER, `search_path = ''`, `authenticated` only):

| Function | Authorization | Purpose |
| --- | --- | --- |
| `create_invitation(slug, email, role_key, valid_days=7)` | `members.invite` + `app.can_grant_role` (subset rule; owner role: owners or platform owner/admin) or platform owner/admin; tenant operating | Returns `{id, token, expires_at}` once; stores SHA-256 of the token; revokes the pending invitation for that email |
| `invitation_preview(token)` | any signed-in user holding the token | University, role, status, `email_matches`, masked email |
| `accept_invitation(token)` | confirmed email = invited email; pending; tenant operating | Upserts an active membership + role; returns the slug |
| `tenant_invitations(slug)` / `revoke_invitation(id)` | `members.invite`/`members.manage` or platform owner/admin | Pending list (never the hash) / revoke |
| `tenant_members(slug)` | `members.read` or support grant | Members with email, roles, departments |
| `update_tenant_profile(slug, name_translations, locale, timezone)` | `tenant.settings.manage` | Display names en/ar, defaults |
| `publish_branding(slug)` | `tenant.branding.manage` | Draft → published, `published_by = caller` |
| `platform_tenants()` / `platform_staff()` | any platform role / platform owner, admin | Aggregate counts only / staff directory |

Guards:
- `app.ensure_tenant_keeps_owner` (AFTER triggers): every university keeps one active owner.
- `app.guard_owner_changes` (BEFORE triggers, migration 7): direct API writes that touch ownership require an owner or platform owner/admin (ADR-018).

Storage: public bucket `tenant-assets` (1 MB, PNG/JPEG/WebP). Insert/update/delete/list require `tenant.branding.manage` for the tenant in the first path segment (`app.try_uuid`). `app.valid_branding` limits `logo_path` to `<uuid>/<safe name>`.

## 2c. Phase 5 — student assistant (implemented, migration 10 `assistant`, applied 2026-11-23)

| Table | Columns (main) | RLS (select only; all writes go through functions) |
| --- | --- | --- |
| `assistant_settings` | `tenant_id` pk, `enabled` (default false), `instructions` (≤ 2,000), `monthly_budget_usd` (default 50), `updated_by` | `assistant.configure` |
| `assistant_conversations` | `id`, `tenant_id`, `user_id`, `title` (first question, ≤ 120) | author only, while a member |
| `assistant_messages` | `role` user/assistant, `content` (≤ 20,000), `status` question/answered/no_sources/refused/error, `citations` jsonb, `sources` jsonb, `model`, `input_tokens`, `output_tokens`, `latency_ms`; composite FK to the conversation | author of the conversation only |
| `assistant_feedback` | `message_id` pk, `rating` −1/1, `comment` (≤ 1,000) | own feedback |
| `ai_usage_events` | `feature`, `model`, input/output/cache-read/cache-write tokens, `cost_usd` (estimated) | `assistant.configure` |

Functions (SECURITY DEFINER, `search_path = ''`, `authenticated` only):

| Function | Authorization | Purpose |
| --- | --- | --- |
| `assistant_status(slug)` | member | `{can_use, feature, enabled, within_budget}` |
| `assistant_update_settings(slug, enabled, instructions, budget)` | `assistant.configure` + feature | Upsert settings (audited) |
| `assistant_begin_turn(slug, conversation, question)` | `assistant.use`, feature, enabled, within budget; own conversation | Stores the question; returns the conversation id, the last 10 question/answer turns, instructions and the support email. Errors: 42501, 55000 (off), 53400 (budget), 22023 (question length), P0002 (not your conversation) |
| `assistant_complete_turn(conversation, content, status, citations, sources, model, usage, latency)` | author of the conversation | Stores the answer and, when a model was called, an `ai_usage_events` row |
| `assistant_set_feedback(message, rating, comment)` | author of the conversation | Rate an answer (upsert) |
| `assistant_usage_summary(slug)` | `assistant.configure` | This month's counts, tokens and estimated cost (aggregates only, no content) |

`app.assistant_month_cost(tenant)` sums the current month's estimated cost for the budget check. Settings changes are audited. Messages and usage are not audited row by row (they are the records themselves). Integrity caveat: ADR-024.

## 2d. Phase 6 — admissions (implemented, migration 11 `admissions`, applied 2026-11-23)

| Table | Contents | Access |
| --- | --- | --- |
| `admissions_settings` | public page switch, contact email, privacy URL, welcome texts (en/ar), consent wording (en/ar) + `consent_version`, assistant switch, instructions, monthly budget (default 20 USD), daily questions per visitor (default 20) | read: `programs.manage`, `assistant.configure` or `leads.read`; writes through functions; audited |
| `admission_programs` | code, names (en/ar), level, department, description/requirements/intakes/tuition notes (en/ar), duration, study mode, language, tuition amount + currency + period, deadline, https application URL, status draft/published/archived, `published_at` | read: `programs.manage` or `leads.read`; **direct writes** with `programs.manage` (RLS) + feature; audited; public read only through `public_admissions` |
| `admission_leads` | reference (`L-00001` per university), name, email and/or phone, country, program, intake, message, locale, source form/assistant/manual, stage new→contacted→qualified→applied→admitted→enrolled / lost (+ reason), assignee, **consent record** (`consent_at`, `consent_version`, `consent_text`), submitter, linked conversation | read: `leads.read`; changes through functions with `leads.manage`; **not** in the generic audit log (ADR-026) |
| `admission_lead_notes`, `admission_lead_events` | internal notes; history (created, stage, assigned, program, note) | read: `leads.read`; deleted with the lead |
| `app.admission_lead_counters` | per-university lead numbers | private |
| `assistant_conversations.agent` | `student` or `admissions` | visitors read only their own admissions conversations; staff cannot |

Functions:

| Function | Who | Purpose |
| --- | --- | --- |
| `public_admissions(slug)` | anyone (`anon` too) | Published programs + public settings + published branding, or `null` |
| `admissions_submit_lead(…)` | any session (anonymous included) | Inquiry with the consent record; checks the wording/version; 3 per visitor per university per day; published programs only; own admissions conversation only |
| `admissions_search(slug, query, limit)` | any session, page and assistant on | Full-text search over published documents with visibility `public` |
| `admissions_begin_turn(slug, conversation, question)` | any session | Gates (page + assistant on, budget, daily limit per visitor, 1–1000 characters); returns history, instructions, contact email |
| `admissions_update_settings(…)` / `admissions_update_assistant(…)` | `programs.manage` / `assistant.configure` | Page settings (new consent wording = new version) / assistant switch, guidance, budget, daily limit |
| `admissions_create_lead(…)` | `leads.manage` | Inquiry received in person/by phone, with a consent note |
| `admissions_update_lead(lead, stage, lost_reason, assignee, program)` | `leads.manage` | Pipeline; assignee must read leads; every change logged |
| `admissions_add_note(lead, body)` / `admissions_delete_lead(lead)` | `leads.manage` | Notes / erasure (PII-free audit entry) |
| `admissions_assignees(slug)` / `admissions_analytics(slug)` | `leads.read` | Assignable people / counts by stage, source, program, 12 weekly buckets, assistant usage this month |

Migration 12 `admissions_maintenance` (**written and tested locally, not applied yet**):
- `admissions_export_lead(lead)`: `leads.read`. Returns everything stored about one inquiry (contact details, program, message, consent record, notes, history without internal ids) and writes a PII-free audit entry `admission_leads.export`. The app downloads it as JSON from the inquiry page.
- `app.cleanup_anonymous_visitors(days ≥ 7)`: not callable through the API. Deletes anonymous accounts older than N days and unused since. To be scheduled with pg_cron (`supabase/README.md`).

Also changed: `assistant_complete_turn` and `assistant_set_feedback` accept admissions conversations without membership; usage is booked per agent (`app.ai_month_cost(tenant, feature)`), so each agent has its own budget; `assistant_usage_summary` counts student conversations only.

## 2e. Phase 7 — tickets and handoff (migration 13 `tickets`, **written and tested locally, not applied yet**)

| Table | Contents | Access |
| --- | --- | --- |
| `ticket_categories` | names (en/ar), department to route to, default priority, active, sort order | read: members (feature `ticketing`); **direct writes** with `departments.manage` (RLS); audited |
| `tickets` | reference (`T-00001` per university), subject, category, department (queue), priority low/normal/high/urgent, status open/in_progress/waiting/resolved/closed, source portal/assistant, requester + name snapshot, assignee, shared conversation, `first_response_at`, `resolved_at`, `closed_at`, `last_activity_at` | read: requester, department staff (`tickets.read_department`), `tickets.read_all`, assignee (`app.can_read_ticket`); changes through functions only; **not** in the generic audit log (ADR-027) |
| `ticket_messages` | public thread: author, name snapshot, `from_staff`, body | same as the ticket |
| `ticket_internal_notes` | staff notes and AI summaries (`kind` note/ai_summary, `model`) | staff who work the ticket with `tickets.notes.read`, **never the requester** (`app.can_read_ticket_notes`) |
| `ticket_events` | history: created, status, priority, department, category, assigned | staff only (`app.is_ticket_staff`) |
| `notifications` | per person: kind (ticket_new, ticket_assigned, ticket_reply, ticket_status), ticket, `read_at` | only the person it is for |
| `app.ticket_counters` | per-university ticket numbers | private |

Functions:

| Function | Who | Purpose |
| --- | --- | --- |
| `tickets_create(slug, subject, body, category, conversation)` | `tickets.create` | New request routed by category; 10 per person per day; only the requester's own conversation can be shared; notifies the queue |
| `tickets_reply(ticket, body)` | requester or staff who work it | Reply. A staff reply sets "in progress" and the first response time; a requester reply reopens "waiting"/"resolved". Closed tickets refuse replies (`55000`) |
| `tickets_close(ticket)` | requester | Close one's own request |
| `tickets_update(ticket, status, priority, category, department, assignee)` | `tickets.update` | Status, priority, category; self-assignment; transfers and assigning others need `tickets.assign`; every change is logged and notified |
| `tickets_add_note(ticket, body)` / `tickets_add_ai_summary(ticket, summary, model)` | `tickets.notes.write` | Internal note / AI summary note |
| `tickets_shared_conversation(ticket)` | staff who work it | The shared conversation, only messages up to the ticket's creation |
| `tickets_assignees(slug, department)` | staff | People who can work tickets in that queue |
| `tickets_ai_begin(slug)` / `tickets_ai_record(slug, model, usage)` | `tickets.create` or `tickets.update` | AI gate (monthly budget `53400`, 30 calls per person per day `54000`) and usage booking as feature `ticketing` |
| `my_notifications(slug, limit)` / `notifications_mark_read(slug, ids)` | any member | The person's notifications / mark some or all read |

Also changed: `app.assistant_month_cost` adds ticketing usage to the student assistant's budget; `assistant_usage_summary` includes it.

## 2f. Phase 8 — analytics and AI quality (migration 14 `analytics`, **written and tested locally, not applied yet**)

No rollup tables: every figure is computed from the rows above when it is requested (ADR-028). New indexes: `assistant_messages (tenant_id, created_at)`, `assistant_feedback (tenant_id, created_at)`, `tickets (tenant_id, created_at)`.

| Table | Contents | Access |
| --- | --- | --- |
| `ai_quality_reviews` | one row per reviewed assistant message: outcome (correct, knowledge_added, knowledge_needed, assistant_error, out_of_scope), note, reviewer + name snapshot, time | read: `quality.review`; writes through functions only; **not** in the generic audit log |

Functions:

| Function | Who | Purpose |
| --- | --- | --- |
| `analytics_overview(slug, days)` | `analytics.view` + `analytics_basic` (90 days: `analytics_advanced`) | Per assistant: questions, outcomes, people, feedback, median answer time and a daily (weekly for 90 days) series. Tickets: volume, from the assistant, resolved, backlog by status, unassigned, waiting for a first reply, median first-reply and resolution times, open by department, new by category, series. Admissions inquiries by source. Knowledge: published, expired, unpublished, the 10 most cited documents the caller may read. AI cost this month per feature vs budgets, and the period's calls, cost and tokens (`analytics.ai_costs.view`). Quality queue counts (`quality.review`). Sections are null when the feature is off |
| `quality_gaps(slug, days, agent, state, limit)` | `quality.review` or `knowledge.manage` | Questions without a source, grouped by normalized wording, most asked first: redacted latest wording, count, open count, first/last asked, assistants, message ids to review |
| `quality_flagged(slug, kind, days, agent, state, limit)` | `quality.review` | Answers rated not helpful (`negative`) or declined (`refused`): redacted question and comment; the answer and citations only when the reviewer can read every source document (`visible`) |
| `quality_summary(slug, days)` | `quality.review` | Open counts per queue, reviews in the period and their outcomes |
| `quality_review_save(slug, messages[], outcome, note)` / `quality_review_reopen(slug, messages[])` | `quality.review` | Review 1–200 flagged answers of this university at once (only gaps, declined or rated not helpful) / put them back in the queue |

Private helpers: `app.analytics_period` (the university's days), `app.redact_pii`, `app.normalize_question`, `app.can_see_document_content`, `app.can_see_answer`, `app.question_of`, `app.agent_enabled`, `app.quality_counts`.

## 2g. Phase 9 — academic assistant (migration 15 `academic`, **written and tested locally, not applied yet**)

| Table | Contents | Access |
| --- | --- | --- |
| `courses` | code (unique per term), titles en/ar, description, department, term, status draft/active/archived, **per-course enablement** (`ai_enabled` + one switch per tool), instructor guidance, join code (8 characters) and `join_open` | read: the course's teachers and academic managers; its students while active (`app.can_view_course`). The join code is **not a readable column** (`academic_course_admin`); audited |
| `course_members` | course, person, role instructor/student, added by | read: one's own row, or teachers of the course; changes through functions; audited |
| `knowledge_documents.course_id` | a course material (always `restricted`) | readable by the course's teachers, and by its students once published; never by knowledge-base roles; excluded from `search_knowledge` and from the knowledge base pages |
| `academic_settings` | monthly AI budget (default 20 USD) and study aids per person per day (default 20) | read: `academic.manage`; audited |
| `academic_items` | a study aid: kind summary/quiz/flashcards/study_plan, title, language, content, **answer key** (quizzes), progress, sources, model | read: its owner only; `answer_key` is not a readable column; not audited (study data) |
| `academic_quiz_attempts` | answers, per-question result and material, score | read: its owner only |
| `app.academic_join_failures` | wrong join codes per person (10 per hour) | private |

Also new: the system role `faculty` (Faculty member), added to existing universities.

Functions:

| Function | Who | Purpose |
| --- | --- | --- |
| `academic_create_course` / `academic_update_course` | `academic.manage` | Course details and status (creates the settings row with defaults) |
| `academic_update_course_ai(course, enabled, summaries, quizzes, flashcards, study_plans, guidance)` | teachers | Per-course enablement and guidance |
| `academic_set_join(course, open, rotate)` / `academic_course_admin(course)` | teachers | Joining open/closed, new code / the code and counts |
| `academic_add_instructor(course, email)` | `academic.manage` | An active member with `academic.use`; the same "not found" for anything else |
| `academic_remove_member(course, user)` | managers anyone; teachers students; students themselves | Remove or leave |
| `academic_join_course(slug, code)` | `academic.use` | Join an active, open course; wrong codes counted (`{status: 'invalid'}`, 54000 after 10 per hour) |
| `academic_course_roster(course)` | teachers | Names, roles, since when |
| `academic_begin_upload(course, document, file…)` / `academic_set_material_published(document, published)` | teachers | Materials through the knowledge pipeline / publish to students |
| `academic_begin_generation(course, kind, documents[])` | teachers or the course's students | Gate: course active and tools on, tool allowed, 1–10 usable materials, budget (53400), daily limit (54000). Returns the materials (≤ 120,000 characters) |
| `academic_save_item(…)` / `academic_record_usage(…)` | same | Store a checked study aid and book usage / book usage only |
| `academic_submit_quiz(item, answers)` / `academic_quiz_review(item)` | the owner | Grade in the database; answers and explanations only after an attempt |
| `academic_update_progress(item, state)` / `academic_delete_item(item)` | the owner | Flashcards known / plan sessions done; delete |
| `academic_update_settings(slug, budget, daily_limit)` / `academic_overview(slug, days)` | `academic.manage` | Budget and limit / activity, month cost |
| `academic_course_insights(course, days)` | teachers | Class figures; accuracy per material only from 5 students |

Changed: `app.can_read_knowledge` / `app.can_manage_knowledge` (course branch), the storage delete rule (teachers remove their materials' files), `search_knowledge` (course materials excluded), `analytics_overview` (course materials excluded from the knowledge figures; academic section, cost and budget).

## 2h. Phase 10 — staff assistant (migration 16 `staff`, **written and tested locally, not applied yet**)

| Table | Contents | Access |
| --- | --- | --- |
| `assistant_conversations.agent` | now also `staff` | as before: the author only |
| `staff_assistant_settings` | on/off (default off), guidance (≤ 2,000 characters), monthly budget (default 20 USD), daily limit per person (default 60, 1–500) | read: `assistant.configure`; changes through `staff_assistant_update_settings`; audited |
| `staff_drafts` | kind email/letter/announcement, title, language, content `{subject, body, missing[]}`, sources (≤ 10 documents), model | read: the author only (and only while a member); written through functions; not audited (the author's own work) |

Functions:

| Function | Who | Purpose |
| --- | --- | --- |
| `staff_assistant_status(slug)` | members | can use, feature, enabled, within budget, can make a ticket digest |
| `staff_assistant_update_settings(slug, enabled, guidance, budget, daily_limit)` / `staff_assistant_usage(slug)` | `assistant.configure` | Settings / this month's questions, drafts, people and cost |
| `staff_begin_turn(slug, conversation, question)` | `assistant.staff.use` | Gate (`app.staff_gate`: permission, feature, switch 55000, budget 53400, daily limit 54000), then a staff conversation turn; other agents' conversations are "not found" |
| `staff_ai_begin(slug, kind)` | same; a digest also needs `ticketing` and a ticket queue permission | Gate before a draft or a digest; returns the guidance |
| `staff_save_draft(…)` / `staff_record_usage(…)` / `staff_delete_draft(draft)` | same / the author | Store a draft and book usage / book usage only / delete one's own draft |
| `staff_ticket_digest_source(slug, scope, department)` | ticket staff | Up to 60 open tickets of one view (`mine`, `department` optionally one, `all` with `tickets.read_all`), only tickets the caller works, never their own requests: subject, status, priority, category, department, assignment, ages, first and latest message (shortened). No requester identity, no internal notes |

Changed: `search_knowledge` gained `p_department` (narrows the readable set only); `assistant_complete_turn` books staff answers as `staff_assistant`; `analytics_overview` gained the staff agent, its month cost and its budget.

## 3. Phase 15 — plans, features, subscriptions (planned)

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
| 5 Chat | Implemented, see §2c. Citations are stored on the message (jsonb with chunk, document and pages); knowledge gaps are messages with status `no_sources` |
| 6 Admissions | Implemented, see §2d |
| 7 Tickets | Implemented, see §2e (migration 13 not applied yet). Not built: `ticket_attachments`, assignment rules beyond categories, SLAs |
| 8 Analytics | Implemented without rollups, see §2f (migration 14 not applied yet). `daily_tenant_metrics` only if volumes require it |
| 9 Academic | Implemented, see §2g (migration 15 not applied yet): materials are knowledge documents with `course_id`; study aids in `academic_items`; mastery per material from quiz attempts |
| 10 Staff assistant | Implemented, see §2h (migration 16 not applied yet): staff conversations in `assistant_conversations`, drafts in `staff_drafts`; ticket digests are not stored |
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
