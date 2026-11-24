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

## ADR-028 — Analytics computed from stored rows on request; AI quality review sees single exchanges, pseudonymized and redacted
**Accepted · 2026-11-23**

**Context:** Phase 8 adds the admin dashboard, the knowledge-gap report and the AI quality review. The rules are: numbers only from stored events, nothing invented, nothing across universities. Assistant conversations were private to their author (ADR-023, ADR-025). Reviewing what the assistants could not answer, or answered badly, means some staff must see some questions and answers.
**Decision:**
- **Computed on request, from the stored rows.** `analytics_overview` reads assistant messages, feedback, AI usage, tickets, admissions leads, knowledge documents and memberships for the period. There are no rollup tables, so there is no scheduled job, and a number cannot drift from its source. Periods without data show zeros; a share with nothing to divide shows a dash, never 0 %. Days are the university's own days (`tenants.timezone`). Rollups (`daily_tenant_metrics`) come later, only if a university's volume makes these queries slow.
- **Who sees what:**
  - aggregate numbers: `analytics.view` and feature `analytics_basic`; periods over 30 days need `analytics_advanced`;
  - AI cost and budgets: `analytics.ai_costs.view`;
  - the knowledge-gap report (question text): `quality.review` or `knowledge.manage`;
  - flagged answers (question, answer, sources, comment) and reviews: `quality.review` only.
  The pages follow the same rules, but the database enforces them.
- **What a reviewer sees of a conversation:**
  - one exchange at a time: the flagged answer and the question it answered, never the rest of the conversation;
  - never who asked: no person, account or conversation id;
  - contact details, links and digit runs of 8 or more digits (phone numbers, student and national ids, also in Arabic-Indic digits) are replaced by `[email]`, `[link]` and `[number]` before the text leaves the database. Dates are kept. This is best effort: names cannot be detected, so the page tells reviewers not to copy personal details into notes;
  - **the answer and its citations are withheld** unless the reviewer could read every knowledge document it was built from (whatever its publication state now). The person who asked may have had wider access than the reviewer. A deleted document, or a source that cannot be checked, also hides the answer.
- **Unanswered questions are grouped** by a normalized form of the question: case, punctuation, spacing, Arabic letter variants, diacritics, tatweel and Arabic-Indic digits are ignored. A group is reviewed at once (up to 200 messages).
- **Reviews** (`ai_quality_reviews`) record an outcome (answer was correct, knowledge base updated, needs a document, assistant mistake, out of scope) with an optional note, the reviewer and the time. Like tickets and leads, they are not copied into the append-only audit log, because a note may quote a question. Saving again changes the outcome; reopening deletes the review.
- **People are told.** The student chat and the public admissions assistant now say that unanswered questions and rated answers may be reviewed by university staff without the person's identity, to improve the assistant.
- The tables themselves keep their row-level security: reviewers still cannot select assistant messages or feedback. Only the review functions expose single, redacted exchanges.

**Consequences:** Conversations are no longer seen only by their author. The knowledge-gap and flagged-answer exceptions are narrow, pseudonymized, redacted and disclosed to the people asking. The rules are covered by 25 DB tests. Re-identification from what someone wrote remains possible in small groups; universities should say so in their privacy notice. AI clustering of gap questions (which would need the API key) and email digests are not built.

## ADR-029 — Academic assistant: course materials in the knowledge pipeline, private study aids, answers kept in the database
**Accepted · 2026-11-23**

**Context:** Phase 9 adds study tools: summaries, practice quizzes, flashcards and study plans, built from the materials instructors provide. They must be labelled as AI-generated and switched on per course. Course content belongs to a course, not to the whole university. Students' study data is personal.
**Decision:**
- **Who:**
  - Academic managers (`academic.manage`) create courses and assign instructors.
  - Instructors are course members with the role `instructor` (they need `academic.use`). They manage only their courses: materials, the study tools, enrollment, class figures.
  - Students join an active course with an 8-character code (no look-alike characters). Teachers can close joining or make a new code. Wrong codes are counted in the database: after 10 in an hour, joining is refused.
  - A new system role **Faculty member** gives teaching staff academic access without managing courses. It is added to existing universities as well.
- **Course materials reuse the Phase 4 pipeline** (upload, verification, extraction, chunks, versions, storage). A material is a knowledge document with `course_id`, always `restricted`:
  - only the course's teachers read it (drafts included);
  - its enrolled students read it once published;
  - knowledge-base roles do not reach it;
  - it never appears in the university knowledge base or in the general assistant's retrieval.
  `app.can_read_knowledge` and `app.can_manage_knowledge` gained a course branch; the other rules are unchanged, and all Phase 4 tests still pass. Teachers delete a material's files first, then its rows, because the storage delete rule needs the document to exist.
- **Per-course enablement:** the tools are off until a teacher turns them on, and each of the four tools can be allowed or not. The database refuses generation for a course or tool that is off, or a course that is archived.
- **Generation** is one structured-output call per study aid:
  - the materials (up to 120,000 characters, in the chosen order) go first as cached data, then the task and the instructor's guidance (`<instructor_guidance>`, which cannot change the rules);
  - every item carries a reference to its material and pages, and references to materials that were not sent are dropped;
  - malformed quiz questions are removed (4 distinct options, one correct);
  - effort is medium for quizzes and summaries, low for flashcards and plans;
  - usage is booked as `academic_agent`, with its own monthly budget (default 20 USD) and a daily limit per person (default 20).
- **Labelling:** every study aid shows "AI-generated", a notice that it can contain mistakes, is not an official course document and does not count towards any grade, and the materials it was made from.
- **Privacy:**
  - study aids and quiz attempts are visible only to the person who made them, not to instructors, managers or the owner;
  - a quiz's answer key is a column clients cannot select; grading happens in the database (`academic_submit_quiz`), and the answers are returned only after an attempt;
  - teachers see class figures only. Quiz accuracy per material appears once at least 5 students answered on it;
  - study data is not copied into the audit log. Courses, enrollment and settings are.
- **Not built:** students' own uploads, instructor-reviewed quizzes shared with the class, a course chat, eval sets for the study tools, LMS/SIS integration (Phase 14).

**Consequences:** One ingestion pipeline serves both the knowledge base and courses. The access rules are enforced and tested in the database (28 tests). As with ADR-024, generated content and usage are saved with the student's own session: a student could store fake content in their own private study aids or under-report usage. This is accepted for now; a service-role worker would close it.

## ADR-030 — Staff assistant: the grounded pipeline for staff, a department filter that only narrows, private drafts, a redacted ticket digest
**Accepted · 2026-11-24**

**Context:** Phase 10 adds an internal assistant for staff: search of department and internal knowledge, drafting tools, and ticket summaries. Staff may read more documents than students, including internal ones, and they work tickets about named people. Nothing here may widen what someone can already read, and nothing may be sent in the university's name by the AI.
**Decision:**
- **Who:**
  - People with `assistant.staff.use` use it, when the university has the `staff_assistant` feature. That permission is in the staff role templates, department administrators, owners and administrators.
  - People with `assistant.configure` switch it on and set it up (`staff_assistant_settings`): on/off (off by default), guidance, a monthly budget (default 20 USD), and a daily limit per person (default 60 requests over the last 24 hours, counting questions, drafts and digests together). Settings changes are audited.
- **Questions** reuse the grounded pipeline of the student assistant (ADR-024):
  - conversations have the agent `staff` and stay private to their author; a staff conversation cannot be continued from the student chat, or the other way round;
  - retrieval runs with the staff member's own session (`search_knowledge`), so internal and restricted documents appear only when their role or department may read them;
  - the optional department filter (`p_department`) only narrows that set, never widens it; course materials stay excluded;
  - the staff prompt profile: an internal assistant that refers to the department responsible for the topic and never decides about individual students or staff (grades, exceptions, discipline, payments);
  - the chat reminds staff not to forward internal details to people who may not see them.
- **Drafts** (email, letter, announcement) take one structured-output call at medium effort, with:
  - up to 6 passages from the documents the person can read (optionally one department's), the request, and the university's guidance;
  - facts only from the passages or the request: missing details stay as [placeholders] and are listed for the author;
  - as sources, only the documents of the passages the model says it used (numbers checked against what was sent).
  Drafts are kept in `staff_drafts`, readable only by their author. They are not audited (the author's own work) and can be deleted. The AI never sends anything: staff copy the text.
- **Ticket digest**, for people who work tickets (the `ticketing` feature plus `tickets.read_department` or `tickets.read_all`):
  - **Selection:** `staff_ticket_digest_source` picks up to 60 open, in-progress or waiting tickets from one view: assigned to me, my departments (optionally one), or all (`tickets.read_all` only). It takes only tickets the person can work (`app.is_ticket_staff`), never their own requests, ordered by priority and then waiting time.
  - **What is sent:** subject, status, priority, category, department, whether assigned, ages, the first message (≤ 800 characters) and the latest one (≤ 400). Requester names and ids and internal notes are never included. Before sending, the app also replaces e-mail addresses and numbers of 8 or more digits (phone numbers, student ids). This is best effort: names inside the text can remain.
  - **Result:** an overview, themes, tickets needing attention and suggested next steps. Ticket references are checked against the view before they become links (the ticket page checks access again). The digest is shown once and not stored. Low effort.
- **Usage** is booked as `staff_assistant`: answers through `assistant_complete_turn`, drafts and digests through `staff_save_draft` / `staff_record_usage`. Analytics shows a staff assistant card and the staff budget.
- **Not in the AI quality review:** staff conversations can quote internal matters, and staff were not told that their questions may be reviewed. They are left out of the knowledge-gap and flagged-answer queues (`app.agent_enabled`), but counted in analytics.

**Consequences:**
- Department-scoped search, drafting and ticket summaries share the existing gates and row-level security. 16 DB tests cover:
  - the gate and the settings;
  - conversations kept apart;
  - department-scoped search;
  - private drafts;
  - the digest scope: no other departments' tickets, no own requests, no notes, no requester identity;
  - usage and analytics.
  18 unit tests cover the redaction, the prompts and both tools with a fake model and database.
- As in ADR-024, ADR-027 and ADR-029, drafts and usage are written with the person's own session. A staff member could store any text in their own drafts, or under-report usage, by calling the API directly. A service-role worker would close this.
- The digest sends redacted ticket text to the AI provider: universities must cover this in their data-processing terms.
- **Not built:** sending drafts from the app (needs email integration), shared templates, an eval set for the staff tools, semantic search (embeddings, ADR-021).

## ADR-031 — Service request workflows: versioned forms, a confirmation step, tracking numbers, an AI that only pre-fills
**Accepted · 2026-11-24**

**Context:** Phase 11 adds structured requests to university offices (an official transcript, an enrollment certificate, a leave of absence). People need the right form, a clear confirmation before anything is sent, a tracking number and status updates. Offices change their forms over time, and a request must still be read against the form its requester saw.
**Decision:**
- **Forms are versioned.** A form (`workflow_definitions`) holds its title, description and the department that handles it. Its fields live in versions (`workflow_versions`):
  - managers edit one draft, then publish it;
  - a published version never changes (a trigger refuses it) and is retired when the next one is published;
  - a request keeps the version it was made with, so its answers are always shown with the questions the requester saw;
  - submitting with an older version is refused (40001), and the app asks the person to review the updated form.
  Fields: 1–30, of type short or long text, number, date, choice, checkbox or email, with English and Arabic labels and help. Keys are made once from the English label and then kept across versions. The database checks the form (`app.workflow_fields_valid`) and every answer against it (`app.workflow_answers_clean`). The browser applies the same rules only for quick feedback.
- **Permissions reuse the ticket model** (ADR-027), because a service request is a structured request to an office:
  - `tickets.create` to submit and `tickets.read_own` to follow one's own requests;
  - processors need `tickets.update` in the form's department (`tickets.read_department`) or everywhere (`tickets.read_all`); forms without a department go to the general queue;
  - internal notes need `tickets.notes.read` / `write`, and assigning colleagues needs `tickets.assign`;
  - managing forms is routing configuration, like ticket categories: `departments.manage`;
  - everything also needs the `workflow_agent` feature.
  No new permission keys were added, so existing roles work without changes.
- **Nobody processes their own request**, even in their own department: they cannot change its status or assignment, and they never see its internal notes.
- **Confirmation step:** the person fills in the form, then sees exactly what will be sent and the form's confirmation text, and only then submits. A tracking number (`R-00001`, per university) is shown at once.
- **Status flow:** submitted → in review → needs information → approved / rejected → completed; the requester can cancel while nothing is decided.
  - "Needs information" and "rejected" require a message for the requester.
  - When the requester answers a "needs information", the request goes back to review.
  - Status changes and messages notify the other side in-app; assignment events and notes are never shown to the requester.
- **The workflow agent only pre-fills:** a person can describe what they need in their own words. One structured-output call (low effort) chooses the published form that fits, or none, and fills only the values the description states.
  - Values are checked against the form and dropped if they do not fit. Choice labels are mapped to option values. Checkboxes (confirmations) are never ticked by the AI.
  - The person then reviews, completes and confirms like anyone else. The request is marked as started from a suggestion.
  - It has its own switch (off by default), monthly budget (10 USD) and daily limit per person (20), set with `assistant.configure`. Usage is booked as `workflow_agent`.
- **Privacy:** requests, answers and their history are personal data. They are not copied into the audit log. Forms, versions and settings are configuration and are audited. Analytics shows counts only (submitted, completed, open, median time to complete, most requested forms), never who asked.

**Consequences:**
- The roadmap's acceptance criteria are met and covered by 20 DB tests: versioned definitions, a confirmation step, tracking numbers, and status updates.
- The notification list now covers tickets and requests. Its page and bell show when a university has either feature.
- Not built:
  - attachments (needs storage and scanning);
  - multi-step approval chains (several approvers in sequence);
  - deadlines and reminders;
  - email notifications (Phase 14);
  - an eval set for the form suggestion.
- As in earlier ADRs, AI usage is recorded with the person's own session: a person could under-report their own usage by calling the API directly.

## ADR-032 — Campus map and assistant: a directory first, a plan without map tiles, answers only from location records
**Accepted · 2026-11-24**

**Context:** Phase 12 asks for a locations admin, search, a simple map, opening hours and accessibility. People mostly need "where is it, is it open, can I get in". Embedding a street map means loading tiles from a third party on every view, sending location and IP data to it, and loosening the content security policy.
**Decision:**
- **Locations** (`campus_locations`) cover buildings and what is inside them (offices, rooms, services, gates, parking): English and Arabic names and descriptions, a code, the building and floor, the department behind it, coordinates, weekly hours, accessibility facts, contact details and other names for search.
  - Only buildings contain locations, and buildings are not inside anything (one level, no cycles).
  - Deleting a building keeps what was inside it.
  - New locations stay hidden until published.
  - Managing needs `campus.manage`; members of a university with the `campus_assistant` feature see published locations.
  - Locations are not personal data and are audited.
- **Hours** are weekly ranges per day (at most 3, `HH:MM`, a day left out is closed), plus a note for holidays. "No hours given" is kept apart from "closed".
  - The app computes "open now" and the next opening in the university's time zone.
  - Pages show the week starting on Saturday in Arabic and Monday in English.
- **Accessibility** facts (step-free entrance, elevator, accessible toilet and parking, hearing loop, Braille signage) are yes, no or not recorded. The directory says "not recorded" rather than guessing.
- **Search** runs in the database. It folds case, Arabic letter variants, diacritics and punctuation, ignores common question words in both languages, and ranks by how many query words a location contains (names, code, other names, description). An exact name or code ranks first. Substring matching is deliberate: it is forgiving with Arabic word forms, at the cost of some partial matches ranking lower in the list.
- **The map is a simple plan**, not a street map: published locations with coordinates are projected onto a box (north up, proportions kept) and drawn as an SVG.
  - Nothing is loaded from third parties.
  - Every point is a link with an accessible name; the list beside it carries the same information.
  - The plan stays left-to-right in Arabic pages because it is geometry; labels still shape right-to-left.
  - Each location page offers an "Open in OpenStreetMap" link, which leaves the site only when clicked.
- **Campus answers (AI, off by default):**
  - The question is matched against published locations (at most 8). If none match, the person gets a fixed reply and no model is called.
  - Otherwise one structured-output call (low effort) answers only from those records and lists the records it used, which link to their pages.
  - "Open now" is given to the model as a fact computed by the app; the model never computes times.
  - Nothing is stored. Usage is booked as `campus_assistant`, with its own switch, monthly budget (5 USD) and daily limit per person (30), set with `assistant.configure`.

**Consequences:**
- The roadmap criteria (locations admin, search, simple map, hours, accessibility) are covered by 9 DB tests and the app's unit tests.
- Not built:
  - a drawn campus plan image or real map tiles (possible later with a tile provider and a policy decision);
  - routes and indoor directions;
  - holiday calendars and exceptions beyond a note;
  - public (visitor) access to the directory;
  - campus answers inside the student chat;
  - an eval set for campus answers.

