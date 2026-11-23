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
