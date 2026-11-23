# Architecture Decision Log

Format: **ADR-NNN — Title** · Status · Date · Context → Decision → Consequences.

---

## ADR-001 — Single Next.js application (modular monolith)
**Accepted · 2026-11-21**

**Context:** The product has many modules (agents, tickets, knowledge, analytics), and a small team runs it.
**Decision:** Build one Next.js 16 (App Router, TypeScript) application. Server Actions and Route Handlers are the API. Business logic lives in `src/lib/**` modules.
**Consequences:** One deploy and one codebase. Modules stay separated by folder and import rules. A separate service can be extracted later (for example the ingestion worker) without a rewrite.

## ADR-002 — Supabase for Postgres, Auth, Storage
**Accepted · 2026-11-21**

**Context:** We need relational data, strong tenant isolation, auth, file storage, and vector search.
**Decision:** Use Supabase (Postgres + RLS + pgvector + Auth + Storage). Create dedicated UniAgent projects (dev/staging/prod), separate from the existing Code Blue and Terma projects in the same account.
**Consequences:** RLS can rely on `auth.uid()`. There is some vendor coupling to Supabase Auth; data and SQL stay portable Postgres.

## ADR-003 — Shared database, shared schema, `tenant_id` + RLS
**Accepted · 2026-11-21**

**Context:** Options were a database per tenant, a schema per tenant, or a shared schema with RLS.
**Decision:** Shared schema with `tenant_id` on every tenant row, RLS on every table, and composite FKs `(tenant_id, id)`.
**Consequences:** Cheapest to operate and easiest to evolve. Isolation depends on policy correctness, so isolation tests are mandatory (Phase 2 gate). A dedicated database for an enterprise tenant remains possible later.

## ADR-004 — Tenant identified by URL slug (later host), never by client-supplied ID
**Accepted · 2026-11-21**

**Decision:** The workspace URL is `/[lang]/app/[tenant]/…`. The server resolves the slug through RLS and checks membership. Custom domains map host → tenant in the proxy (Phase 3/17). A non-member gets 404, not 403.
**Consequences:** Links are shareable, tabs can hold different tenants, and tenants cannot be enumerated.

## ADR-005 — Locale-prefixed routing with an `app/[lang]` root layout
**Accepted · 2026-11-21**

**Context:** Arabic (RTL) and English are first-class. With Cache Components, reading cookies in the root layout would make every page dynamic.
**Decision:** Use `/[lang]/…` (`en`, `ar`) with `generateStaticParams`, `next/root-params` for `<html lang dir>`, and the proxy redirecting un-prefixed URLs by cookie or `Accept-Language`. Typed dictionaries.
**Consequences:** Marketing pages stay static and SEO-friendly per language. Every internal link must include the locale (helper `href(locale, path)`).

## ADR-006 — Keep Next.js 16 Cache Components enabled
**Accepted · 2026-11-21**

**Decision:** Keep `cacheComponents` and `partialPrefetching` on (the framework default and the future default). Authenticated segments read the session inside Suspense, or set `instant = false`. Session-derived data is never put in shared caches.
**Consequences:** Static shells are fast. Developers must follow the Suspense rules (documented in `authentication.md`).

## ADR-007 — Permission-based RBAC with department scoping and feature entitlements
**Accepted · 2026-11-21**

**Decision:** A fixed permission catalog in code, seeded to the DB. Per-tenant roles (system templates + custom). Department membership scopes staff access. Plan/override features gate modules. All enforced in RLS and the DAL.
**Consequences:** Flexible for universities' differing structures. More rows to manage, which the admin UI hides.

## ADR-008 — Own design system on Tailwind CSS v4 + Radix primitives
**Accepted · 2026-11-21**

**Decision:** Build components in `src/components/ui` using Tailwind v4 tokens mapped to CSS variables (for tenant theming). Use Radix (`radix-ui`) only for complex accessible primitives (menus, dialogs). Icons from lucide. Typeface: IBM Plex Sans + IBM Plex Sans Arabic (one family across both scripts).
**Consequences:** No heavy UI framework. Theming works through CSS variables. We own accessibility details for simple components.

## ADR-009 — Own AI orchestration loop with provider abstraction (default: Anthropic Claude)
**Accepted · 2026-11-21**

**Context:** Tools must run inside our authorization boundary. Cost per tenant must be tracked. The product requires switching providers per task.
**Decision:** Normalized `ChatModelProvider` / `EmbeddingProvider` interfaces. The Anthropic adapter uses the official `@anthropic-ai/sdk` with the Messages API, streaming, strict tools, and native document citations. Model routes are DB configuration, defaulting to `claude-opus-5-5`, with cheaper models per route only after evaluation and owner approval.
**Consequences:** More code to own than a hosted agent product, but full control over security, data, and cost.

## ADR-010 — Postgres-backed job queue for background work
**Accepted · 2026-11-21**

**Decision:** A `jobs` table with `FOR UPDATE SKIP LOCKED`, processed by a worker invoked by the host's scheduler or a long-running Node process.
**Consequences:** No extra infrastructure in the MVP. It may move to a dedicated queue if volume demands.

## ADR-011 — Hosting: Vercel first, Cloudflare at the edge, portability preserved
**Proposed · 2026-11-21**

**Decision:** Deploy the app on Vercel initially, with Cloudflare for DNS/WAF/Turnstile. Run a spike after Phase 2 to evaluate hosting the app on Cloudflare Workers (OpenNext) under Next.js 16 Cache Components.
**Consequences:** Lowest-risk path now. The final decision is recorded after the spike.

## ADR-012 — UI preview mode only when no auth backend is configured
**Accepted · 2026-11-21**

**Context:** The product owner needs to see the dashboard shell before Supabase exists.
**Decision:** `UNIAGENT_UI_PREVIEW=true` renders the workspace with a fictional identity **only if Supabase is not configured**. It shows a permanent banner, and it is ignored once auth is configured.
**Consequences:** No auth bypass can coexist with real data. Covered by unit tests.

## ADR-013 — Static header-based CSP now, nonce-based CSP for app routes later
**Accepted · 2026-11-21**

**Context:** Nonce CSP requires dynamic rendering, which conflicts with static marketing pages.
**Decision:** Phase 1 ships strict headers and a CSP with `'unsafe-inline'` scripts (needed for Next's inline bootstrap on static pages) plus `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'`. Phase 16 adds nonce-based CSP in the proxy for the dynamic `/app` and `/platform` segments.
**Consequences:** Good baseline now, with a documented hardening step.

## ADR-014 — No blanket platform-staff access to university content
**Accepted · 2026-11-22**

**Context:** A first draft of the RLS policies let any platform role read every university's members, roles and departments. The isolation suite caught it (T11). The master prompt requires that administrative access to tenant data happen only through an explicit, audited mechanism.
**Decision:** Platform roles (owner included) see tenant *metadata and configuration* (tenants, settings, branding, domains, features) and platform tables. Tenant *content* (memberships, profiles, roles, departments, invitations, and later tickets/documents/conversations) requires membership + permission, or an active, time-boxed `support_access_grant` (≤ 24 h, read-only, audited). Platform operations such as onboarding go through audited SECURITY DEFINER functions (`create_tenant`).
**Consequences:** Verified by tests T11, T11b, T12, T13 and live (platform owner without a grant gets "not found" on a university workspace). Support tooling (Phase 3) must request grants.

## ADR-015 — Migrations in git are the schema's source of truth
**Accepted · 2026-11-22**

**Decision:** All DDL lives in `supabase/migrations/*.sql`, applied in order; file versions equal the versions recorded in the project, and the applied statements are checked byte-for-byte (md5) against the files. No schema changes through the dashboard.
**Consequences:** The database can be rebuilt from git; drift is detectable.

## ADR-016 — Isolation tests on plain PostgreSQL with a Supabase shim; live tests opt-in
**Accepted · 2026-11-22**

**Context:** Docker (Supabase local stack) is not always available; isolation must be tested on every change.
**Decision:** `supabase/tests/supabase-shim.sql` recreates the Supabase pieces our SQL depends on (roles, `auth.uid()`, default grants). `npm run test:db` applies shim + migrations to a throw-away database and runs the suite as real roles with JWT claims. Live tests against a real project (`e2e/live`) run only with `LIVE_E2E=1` and dedicated test accounts.
**Consequences:** Fast, CI-friendly isolation tests; the live suite closes the gap to real Supabase Auth/PostgREST behaviour.

## ADR-017 — `tenant_features` as the entitlement source until plans exist
**Accepted · 2026-11-22**

**Decision:** Every tenant gets all catalog features enabled at creation (`tenant_features`). Server-side checks (`app.tenant_has_feature`, `my_tenant_access.features`) already use it; Phase 3/15 will derive it from plans and overrides.
**Consequences:** Feature enforcement is real today and will not need to change shape when plans arrive.

## ADR-018 — Ownership changes are reserved to owners
**Accepted · 2026-11-22**

**Context:** `university_admin` holds every permission, including `roles.manage` and `members.manage`. Through the API an administrator could therefore grant themselves `university_owner` or suspend an owner, so the two roles would differ only in name.
**Decision:**
- Migration 7 adds BEFORE triggers on `membership_roles` (insert/delete) and `tenant_memberships` (status change/delete). When a direct API write (`current_user = authenticated`) touches the owner role or an owner's membership, the caller must be an active owner of that university or a platform owner/admin.
- `app.can_grant_role` applies the same rule to invitations into the owner role.
- SECURITY DEFINER functions that already authorize the caller (`create_tenant`, `accept_invitation`) and backend sessions are not affected.
- Migration 6's last-owner guard (every university keeps one active owner) still applies to everyone.

**Consequences:**
- Ownership is handed over by adding a second owner first.
- Platform staff onboard owners by invitation, never by editing role rows directly (ADR-014).
- Deleting the account of a university's only owner is refused until ownership is transferred.

## ADR-019 — Support sessions get a fixed read-only page set
**Accepted · 2026-11-22**

**Context:** `my_tenant_access` returns no tenant permissions for support-access sessions (ADR-014). The live test showed the consequence: staff with a valid grant could open only the overview, so support access was useless for troubleshooting.
**Decision:**
- The app maps support sessions to a fixed set: `tenant.settings.read`, `tenant.features.read` and `members.read`. Every page in the set is backed by a read path the database allows for support grants (`tenant_members`, settings, features).
- Write controls are hidden for support sessions, and the database rejects support writes regardless.
- Branding, departments management, audit and every future content module stay hidden unless explicitly added here, with a matching database read path and a test.

**Consequences:** Troubleshooting works without widening database privileges. The page set is reviewed whenever a module adds sensitive content (tickets, documents, conversations).

## ADR-020 — Invitations: hashed single-use tokens, link shown once, email delivery later
**Accepted · 2026-11-22**

**Decision:**
- `create_invitation` generates 32 random bytes (`gen_random_bytes`), returns the hex token once, and stores only its SHA-256 hash.
- Acceptance requires a signed-in user whose **confirmed** email equals the invited address.
- A new invitation for the same email revokes the pending one; links last 1–30 days.
- The preview reveals only a masked email.
- The invitation page is `noindex` and sends `Referrer-Policy: no-referrer`.
- Until a transactional email provider is chosen, the inviter copies the link from the UI. It cannot be shown again.

**Consequences:** A leaked database does not leak usable links, and a forwarded link is useless to anyone else. Email delivery can be added later without changing the token model.

## ADR-021 — Retrieval works on full-text search until an embedding provider is chosen
**Accepted · 2026-11-23**

**Context:** Anthropic has no embeddings endpoint. The plan requires an Arabic/English benchmark (Voyage AI, OpenAI, Cohere) before choosing, and no provider key exists yet.
**Decision:**
- `knowledge_chunks.embedding` is a dimensionless `vector` with `embedding_model`. Retrieval only compares vectors of the same model; HNSW indexes are created per model when one is chosen.
- `search_knowledge` fuses full-text and vector ranks with RRF, and works with full-text only when no query embedding is given.
- `EmbeddingProvider` (`src/lib/knowledge/embeddings.ts`) is configured with `EMBEDDINGS_PROVIDER` / `EMBEDDINGS_MODEL` / `EMBEDDINGS_API_KEY`. Without them, nothing claims semantic search, and the UI says so.

**Consequences:** Useful, tested retrieval today. Adding embeddings later needs a key, a benchmark, an index and a re-embed job, but no schema change.

## ADR-022 — Direct signed uploads; processing after the response with the uploader's session
**Accepted · 2026-11-23**

**Context:** Serverless hosts limit request bodies (about 4.5 MB on Vercel), and no service-role key is configured for background workers.
**Decision:**
- The browser uploads straight to the private bucket with a one-time signed upload token. The token is created only for a version path registered by `knowledge_begin_upload` (a storage policy enforces this).
- The server then downloads the stored file, verifies its size, content signature and SHA-256, and runs extraction in `after()` with the uploader's session. The database authorizes every step again.

**Consequences:**
- Large files never pass through our request bodies.
- Processing is bounded by the host's function duration. A Postgres-backed worker with retries (architecture.md) replaces `after()` when large volumes or OCR arrive.

## ADR-023 — Student assistant: grounded answers with search-result citations, no model call without sources
**Accepted · 2026-11-23**

**Context:** Phase 5 needs answers that come only from the university's published documents, cite them to the page, respect each student's document permissions, and never invent fees, dates or rules.
**Decision:**
- **Gates in the database.** `assistant_begin_turn` checks membership, `assistant.use`, the `student_assistant` feature, the university's on/off switch and its monthly budget, then stores the question. The app cannot skip a gate.
- **Retrieval as the student.** `search_knowledge` runs with the student's own session, so permission filtering happens in SQL before ranking (ADR-021). Short follow-up questions borrow the previous question's words for retrieval.
- **No passages, no model call.** The fixed "not found" text (in the student's language, with the support email) is stored as `no_sources`. Nothing is spent.
- **Passages as `search_result` blocks with citations enabled.** The response's `search_result_location` citations map back to our chunk ids and pages by index. Citations that do not map are dropped. An answer that cites nothing is stored as `no_sources` (a knowledge gap). (The Phase 0 design said `document` blocks; search results fit retrieved passages better because each carries its own source and title.)
- **Model call:** Claude Opus 5.5 by default (`AI_MODEL`), `effort` medium (`AI_EFFORT`), adaptive thinking (the default), streaming, `max_tokens` 8000 as a runaway cap, a `cache_control` marker on the system prompt, and server-side refusal fallbacks (`fallbacks: 'default'`). A refusal is stored as `refused` with a fixed polite text.
- **Caching, honestly:** the platform system prompt is about 350 tokens, below the model's 512-token minimum, so it is **not cached** today. It starts caching when a university's extra guidance makes it longer. The recorded cache read/write tokens show whether caching happens; savings at this size would be small either way.
- **Prompt layout:** stable platform rules first, the university's extra guidance last and capped at 2,000 characters ("cannot override the rules above"). Passages are declared untrusted reference material. Answers are plain text, so no Markdown renderer is needed and nothing from the model is rendered as HTML.
- **Transport:** a Route Handler that streams NDJSON events (`meta`, `status`, `delta`, `done`, `error`). It is guarded like a Server Action: same-origin only, JSON only, signed-in only, rate-limited per user and IP. The turn always completes and is stored, even if the student closes the page (`after()`).

**Consequences:**
- Every answered message carries numbered, clickable sources. A source opens the current file of the cited document through a 5-minute signed link created with the student's session, so Storage policies decide again.
- The streamed text has no citation markers; the final event replaces it with the stored answer and its markers.
- Tools (ticket drafts, workflows) are not part of Phase 5; they arrive with the phases that need them.

## ADR-024 — AI usage and budgets: estimated in the app, enforced in the database
**Accepted · 2026-11-23**

**Context:** Universities need a spending limit, and the platform needs per-tenant cost figures, before any invoice data exists.
**Decision:**
- Each model call stores provider-reported tokens (input, output, cache read, cache write) and an estimated cost in `ai_usage_events`, through `assistant_complete_turn`.
- Prices live in `src/lib/ai/pricing.ts` (USD per million tokens, list prices as of 2026-11-03). Dated model ids use the longest known prefix. Unknown models are priced at a deliberately high fallback rate, so budgets fail safe. A database price table with effective dates replaces this file when the platform AI console arrives (Phase 15).
- `assistant_settings.monthly_budget_usd` (default 50) is enforced in `assistant_begin_turn` against the current month's estimated spend. All figures are labelled "estimated".

**Consequences:**
- **Limit:** the budget check runs before a call, so one in-flight answer can exceed the budget by its own cost. This is acceptable at a few cents per answer.
- **Integrity caveat:** turns are recorded with the student's session (no service-role key exists yet, ADR-022). A student could therefore add records only to their own conversation, and could understate usage only by calling the function directly. Moving the recording to a service-role worker removes this; it is tracked in TASKS.md.

## ADR-025 — Public visitors use anonymous Supabase sessions; Turnstile is enforced by Supabase Auth
**Accepted · 2026-11-23**

**Context:** Phase 6 lets prospective students without an account ask the admissions assistant and send an inquiry. Anything callable with the public (`anon`) key can be called directly, bypassing any check in our pages. No service-role key exists, and using one in request handlers would bypass RLS anyway (ADR-022).
**Decision:**
- **Reading** the public admissions page needs no session. `public_admissions(slug)` is granted to `anon` and returns only published programs and public settings, or `null`. Unknown, unpublished, suspended and feature-off universities look the same.
- **Writing** (an inquiry, an assistant question) needs a session. A visitor without one gets an **anonymous Supabase sign-in** created by a Server Action. Every inquiry and conversation therefore has an owner, and the database enforces per-visitor limits:
  - at most 3 inquiries per university per 24 hours;
  - a daily question limit set by each university.
- **CAPTCHA:** when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, the visitor session and the sign-in, sign-up and reset forms send a Cloudflare Turnstile token. **Supabase Auth verifies it** when CAPTCHA protection is enabled there, so it cannot be skipped by calling the API directly. The CSP allows Cloudflare's script and frame only when the key is set.
- **Anonymous sessions are not accounts.** `getCurrentUser()` returns `null` for them, so the workspace, the platform console, invitations, staff actions and password changes treat them as signed out. Database functions for members still require membership and permissions, which anonymous users never have. A university's own staff can still use the public page with their normal session.
- **Owner actions:** enable "Allow anonymous sign-ins" in Supabase Auth, and preferably CAPTCHA (Turnstile) together with the site key.

**Consequences:**
- Until anonymous sign-ins are enabled, the public page shows programs, and the form and the assistant say honestly that they cannot receive anything yet. On 2026-11-23 the live project returns `anonymous_provider_disabled`.
- Anonymous users accumulate in `auth.users`. A cleanup job for old anonymous users (their conversations go with them; inquiries keep `submitted_by = null`) is in TASKS.md.

## ADR-026 — Admissions leads: consent records, PII outside the append-only audit log, deletable on request
**Accepted · 2026-11-23**

**Context:** Leads are personal data about people who are not (yet) members. They must be traceable to explicit consent and erasable on request. The generic audit trigger copies whole rows into an append-only log, which would make erasure impossible.
**Decision:**
- **Consent record:** every lead stores `consent_at`, `consent_version` and the exact `consent_text` shown.
  - A university's own wording (English/Arabic) is versioned by the database: a change creates a new version. `admissions_submit_lead` accepts only the current version with its exact text.
  - Without its own wording, only the platform default version (`default-1`) is accepted. Its text lives in the app's dictionaries, so the database cannot compare it.
  - The server action decides the wording, not the browser. If it changed after the page loaded, the visitor is asked to confirm again.
  - Staff-recorded inquiries require a written consent note (`staff-recorded`).
- **No generic audit trigger on leads, notes or events.** Their history is `admission_lead_events` (created, stage, assigned, program, note). It is deleted together with the lead. `admissions_delete_lead` writes one PII-free audit entry: action and reference. Programs and settings contain no personal data and keep the generic trigger.
- **Privacy between roles:**
  - Leads, notes and history need `leads.read`; changes need `leads.manage`. Assignees must be able to read leads.
  - Visitors cannot read their own lead back, and staff cannot read visitors' assistant conversations. A lead created after chatting only records that link (source "assistant").

**Consequences:** Erasure is complete for leads. The audited export for access requests (`admissions_export_lead`) and the anonymous-visitor cleanup are written and tested in migration 12, which is not applied yet. Retention periods remain a policy decision (TASKS.md).

## ADR-027 — Tickets: one queue model, internal notes in their own table, AI only as a draft or a labelled note
**Accepted · 2026-11-23**

**Context:** Phase 7 adds requests from students and staff to university offices, and handoff from the assistant to a person. Requesters must never see internal notes. Staff must see only the tickets of their departments unless they may see all. The AI may help but must not decide or speak to the requester on its own.
**Decision:**
- **One table for all requests** (`tickets`), with a requester, an optional category, a department (the queue), an optional assignee and a status: open → in progress → waiting → resolved → closed.
  - **Routing:** a category names a department and a default priority. Without a category, a ticket goes to the general queue (people with `tickets.read_all`).
  - **Who reads a ticket:** its requester; staff with `tickets.read_department` in that department; staff with `tickets.read_all`; and its assignee.
  - **Who works a ticket** (`tickets.update`): staff who can read it. Taking a ticket yourself is allowed. Assigning someone else or moving it to another department needs `tickets.assign`, and the assignee must be able to work tickets in the target queue.
  - A person who is both requester and staff acts as the requester on their own ticket: no internal notes, no staff actions.
- **Internal notes live in a separate table** (`ticket_internal_notes`) with its own RLS rule, which excludes the requester. Public replies (`ticket_messages`) and notes never share a table, so a query mistake cannot leak a note into the thread. Status and assignment history (`ticket_events`) is staff-only.
- **Writes go through API functions** (`tickets_*`, SECURITY DEFINER). They check the permission, the feature and the ticket's state, write the history and create the notifications. Only categories are written directly (RLS, `departments.manage`).
- **No generic audit trigger on ticket content**, as with leads (ADR-026): requests contain personal details, and the append-only log would keep them forever. `ticket_events` is the history.
- **Handoff from the assistant:** the student starts a request from the chat ("Ask a person"). Sharing the conversation is a checkbox that is **off by default**. When ticked, staff see only the messages up to the moment the request was created (`tickets_shared_conversation`), never later ones, and never a conversation that is not the requester's own.
- **AI:**
  - **Draft:** the student asks for a draft from their own conversation; the subject, description and suggested category fill the form, and the student edits and sends it. Nothing is sent by the AI.
  - **Summary:** staff ask for a summary of the thread and the shared conversation. It is stored as an internal note of kind `ai_summary` with the model name, shown with an "AI-generated, check it" label, and never shown to the requester.
  - Both use structured output at low effort, treat the conversation as data (not instructions), and drop a category the model invented.
  - **Budget:** usage is booked as feature `ticketing` and counts against the student assistant's monthly budget. Each person may make 30 AI calls per day. Over budget or over the limit, the app explains and the form still works without AI.
- **Notifications:** in-app only (`notifications` table, header bell, notifications page): new ticket in your queue, assigned to you, new reply, status change. The person who acted is never notified. Email delivery waits for the email provider (Phase 14).

**Consequences:** The privacy rules are enforced in the database and covered by 26 DB tests, including a regression for NULL comparisons in permission checks. AI usage is recorded with the user's own session, with the same caveat as ADR-024. Attachments, SLAs, assignment rules beyond categories, and email notifications are not built yet (TASKS.md).
