# UniAgent AI — full project prompt (state on 2026-11-25)

> **طريقة الاستخدام:** انسخ كل ما تحت هذا السطر وألصقه في بداية أي محادثة جديدة مع مساعد برمجة
> (Claude أو غيره). يصف هذا البرومت بالتفصيل كل ما بُني في المشروع، وما الذي يعمل وما الذي لم يُنفَّذ،
> والقواعد التي يجب الالتزام بها. كُتب بالإنجليزية لأن أسماء الملفات والجداول والدوال بالإنجليزية.
> المرجع الأدق دائمًا هو المستودع نفسه: `PROJECT_STATUS.md` و`TASKS.md` و`ARCHITECTURE_DECISIONS.md`.

---

## 0. Your role

You are a senior full-stack engineer continuing **UniAgent AI**, a commercial, multi-tenant AI SaaS
for universities (English and Arabic). Everything below already exists in the repository
`musapm/codeblue`, branch `ccr-df7f375e-95dbtr`. Read this whole prompt, then read
`AGENTS.md`, `PROJECT_STATUS.md` and `TASKS.md` before changing anything. Do not rebuild what
exists; extend it, following the conventions in §12.

## 1. The owner's standing rules (follow them exactly)

1. Do not modify the other Supabase projects belonging to CodeBlue or Terma.
2. UniAgent has its own dedicated Supabase project: **"agent"**, ref `zijruhuvzxtuudsvnwgy`,
   region eu-central-1 (Frankfurt), Free plan (no backups yet).
3. Do not deploy to production or make irreversible external changes without explicit authorization.
4. Never make destructive changes without warning.
5. Do not expose secrets.
6. No hard-coded product name, prices or secrets; no fake data presented as real.
7. Report honestly, separating: fully working · partial · UI-only · planned · broken.
8. The owner does the Supabase steps later ("حاجات supabase بعملها كلها لاحقا"). Defer anything that
   needs the owner unless it is necessary ("كل ما يحتاج تدخلي لاحقا الا اذا كان ضروري").
   **Migrations 12–24 are written and tested locally but NOT applied to "agent".**
9. Always end every response with a short summary in Arabic (ملخص قصير بالعربي).
10. "كمل" from the owner means: continue with the next step of the roadmap.

## 2. Stack and repository layout

- **Next.js 16.4.6** (App Router, `cacheComponents: true`, Turbopack, `proxy.ts` instead of
  middleware), **React 19.3**, **TypeScript 5**, **Tailwind CSS 4.3** with own components on Radix
  primitives, `lucide-react` icons, **zod 4**.
- **Supabase**: Postgres with RLS everywhere, Supabase Auth, Storage, pgvector 0.8.2.
  `@supabase/ssr` and `@supabase/supabase-js`.
- **AI**: `@anthropic-ai/sdk` (Claude API), default model `claude-opus-5-5`, effort `medium`
  (configurable with `AI_MODEL`, `AI_EFFORT`). Structured output with `messages.parse` + zod.
- **Documents**: `unpdf` (pdf.js) for PDF, `mammoth` for DOCX; TXT and CSV built in.
- **Tests**: Vitest 5 (unit/component, jsdom), Vitest against plain PostgreSQL 16 + pgvector with a
  Supabase shim (database), Playwright 1.63 + axe (browser), opt-in live suites.
- Node ≥ 22.12.

```
src/app/[lang]/(marketing)   public website (10 pages)
src/app/[lang]/(auth)        login, register, forgot/reset password, invite, two-step pages
src/app/[lang]/admissions    public admissions page per university
src/app/[lang]/app/[tenant]  university workspace (all modules)
src/app/[lang]/platform      platform console (super admin)
src/app/api/*                streaming AI endpoints, voice, export, health
src/app/auth/*               PKCE callback and token-hash confirmation
src/lib/<module>/            schemas.ts (zod), queries.ts, actions.ts ('use server'), ai.ts, view.ts
src/components/<module>/     UI components
supabase/migrations          24 migrations = the schema's source of truth
supabase/tests               database tests + harness + supabase-shim.sql
supabase/seed                demo university + bootstrap platform owner
e2e/                         Playwright (preview mode) + e2e/live (opt-in, real Supabase)
evals/                       AI eval suites (cost money, never in CI)
docs/                        architecture, security, runbooks, ADR companion docs
```

## 3. Architecture decisions (ADR-001 … ADR-037, in `ARCHITECTURE_DECISIONS.md`)

- One Next.js app (modular monolith); Supabase for Postgres/Auth/Storage.
- **Shared database, shared schema, `tenant_id` on every row + RLS**; composite same-tenant foreign
  keys `(tenant_id, id)` so rows can never point across universities.
- Tenant identified by **URL slug** `/[lang]/app/[tenant]`, never by a client-supplied id; a
  non-member gets 404 (no enumeration). Custom domains: table exists, routing **not built**.
- Locale-prefixed routing `/en`, `/ar` (RTL), proxy redirects un-prefixed URLs by cookie or
  `Accept-Language`; typed dictionaries per module (`*.en.ts` / `*.ar.ts`, same shape).
- Permission-based RBAC (35 permissions) with department scoping and feature entitlements (15 features).
- Own design system; own AI orchestration with a provider abstraction (Claude by default).
- UI preview mode only when Supabase is not configured (`UNIAGENT_UI_PREVIEW=true`): fictional
  universities, no writes, no AI.
- No blanket platform-staff access to university content: only time-boxed (≤ 24 h), read-only,
  audited support grants.
- AI usage and budgets estimated in the app, **enforced in the database**; refusals still book usage.
- Hosting plan: Vercel first, Cloudflare in front, code kept portable (nothing deployed).

## 4. Security model (applies to everything)

- RLS on every table; access helpers in the private `app` schema (`app.has_membership`,
  `app.is_tenant_member`, `app.has_permission`, `app.is_platform_admin`, `app.has_support_access`,
  `app.tenant_has_feature`, …) are SECURITY DEFINER with `set search_path = ''`.
- Writes go through SECURITY DEFINER functions that check permission, feature and tenant status.
- Suspended/archived universities: no data access (permissions empty); members see a suspended page.
- **Append-only audit log** written by database triggers on all access and configuration tables;
  personal data (tickets, leads, requests) is deliberately not copied into it.
- Invitations: 256-bit single-use token, only its SHA-256 hash stored, 1–30 days, revocable; the
  invited confirmed email must match; nobody can grant a role with permissions they do not hold;
  every university keeps at least one active owner; admins cannot promote themselves.
- **Two-step sign-in (TOTP)** enforced by the database (migration 23): any account with a verified
  factor reaches nothing with a first-step (`aal1`) session — `app.mfa_ok()` inside the access
  helpers, a restrictive `mfa_required` policy on every public table and on storage objects, and in
  `my_tenant_access`, `my_workspaces`, `my_platform_role`. Platform staff must set it up
  (`PLATFORM_MFA`, default `required`). Not yet tested against a real Supabase Auth.
- **CSP**: signed-in pages (`/[lang]/app/*`, `/[lang]/platform/*`) get a per-request nonce with
  `'strict-dynamic'` from the proxy; prerendered public pages use a static policy with
  `'unsafe-inline'`. Headers: X-Frame-Options DENY, nosniff, strict referrer, COOP,
  `Permissions-Policy: camera=(), microphone=(self), geolocation=(self), payment=(), usb=()`,
  HSTS (no preload until domains are final).
- **Rate limits** shared across server instances: Postgres counters (`public.rate_limit_hit`,
  migration 22) keyed by HMAC-SHA-256 of "name:key" with `RATE_LIMIT_SECRET`; memory fallback when
  not configured. Client IP only from the header the edge sets (`TRUSTED_IP_HEADER`).
- Logger redacts secret-like and personal keys (question, answer, prompt, content, ip, full_name,
  to, …) and masks email addresses in any string.
- Safe redirects (`safeRedirectPath`), same-origin checks on AI endpoints, auth links built from
  the configured site URL (never the Host header).
- The Supabase secret (service-role) key is never used in request handlers (a guard test enforces it).

## 5. Database — 24 migrations (`supabase/migrations`)

| # | File | Contents | On "agent" |
| --- | --- | --- | --- |
| 1 | `20261121200204_foundation` | private `app` schema, enums, tenants, settings, branding, domains, profiles, platform admins, memberships, roles, departments, invitations, support grants, audit_logs; RLS on; least-privilege grants | ✅ applied |
| 2 | `…200228_catalog` | 35 permissions, 15 features, system role templates | ✅ |
| 3 | `…200313_access_policies` | `app.*` helpers and every RLS policy | ✅ |
| 4 | `…200323_audit` | audit triggers | ✅ |
| 5 | `…200345_auth_hooks_and_rpc` | profile on sign-up; `create_tenant`, `my_workspaces`, `my_tenant_access`, `my_platform_role` | ✅ |
| 6 | `20261122105259_management` | invitations functions, `tenant_members`, `update_tenant_profile`, `publish_branding`, `platform_tenants`, `platform_staff`, last-owner guard, `tenant-assets` bucket | ✅ |
| 7 | `…105537_owner_protection` | only owners (or platform owners/admins) change ownership | ✅ |
| 8 | `20261123100613_knowledge` | documents, versions, chunks (tsvector + `vector`), access lists, `search_knowledge`, `tenant-documents` bucket | ✅ |
| 9 | `…121337_knowledge_file_cleanup` | managers may see files of deleted documents to remove them | ✅ |
| 10 | `…124604_assistant` | assistant settings, conversations, messages, feedback, `ai_usage_events`, budget helper | ✅ |
| 11 | `…151820_admissions` | admissions settings, programs, leads with consent/notes/history, public page, visitor inquiries, admissions assistant | ✅ |
| 12 | `20261124100000_admissions_maintenance` | audited lead export, anonymous-visitor cleanup | ❌ local only |
| 13 | `…120000_tickets` | categories (routing), tickets, thread, internal notes, history, in-app notifications, ticket AI gate | ❌ |
| 14 | `…140000_analytics` | `analytics_overview`, AI quality review functions and `ai_quality_reviews` | ❌ |
| 15 | `…160000_academic` | Faculty role, courses, enrollment by join code, course materials, private study aids, server-side quiz grading | ❌ |
| 16 | `…180000_staff` | staff assistant settings, private drafts, staff gate, ticket digest, department filter | ❌ |
| 17 | `…200000_workflows` | versioned request forms, requests `R-00001`, status flow, comments, notes, form-suggestion gate | ❌ |
| 18 | `…220000_campus` | campus locations, hours, accessibility, bilingual search, campus answers gate | ❌ |
| 19 | `…240000_voice` | voice settings, `voice_usage_events`, server gate | ❌ |
| 20 | `…260000_notifications_integrations` | notification preferences, email outbox (references only), integrations + logs | ❌ |
| 21 | `…280000_subscriptions` | plans, subscriptions, payments, sweep, limits, plan AI cap in every AI gate, usage report | ❌ |
| 22 | `…300000_rate_limits` | shared rate-limit counters; RLS on `app.academic_join_failures` | ❌ |
| 23 | `…320000_mfa` | two-step sign-in in the database | ❌ |
| 24 | `…340000_demo` | `app.demo_seed`, `platform_demo_reset` (demo universities only) | ❌ |

Rules used when writing migrations: SECURITY DEFINER + `set search_path = ''`; helpers used in
`if not` checks coalesce to false; a CHECK cannot contain a subquery (use a function); when a
function must change, the migration re-creates it from the previous migration's exact text with
asserted edits (e.g. `analytics_overview`, the AI gates); every migration ends with a grants loop
(`revoke … from public, anon; grant execute … to authenticated, service_role`).

Seeds: `supabase/seed/demo_northbridge.sql` (fictional "Northbridge University", `is_demo = true`,
calls `app.demo_seed` once migration 24 exists) and `bootstrap_platform_owner.sql`.

Roles (templates copied into each university): university_owner, university_admin,
department_admin, admissions_staff, registrar, student_affairs, finance_staff, it_support,
academic_affairs, library_staff, hr_staff, quality_reviewer, faculty, student.

Features: knowledge_base, student_assistant, admissions_agent, ticketing, analytics_basic,
analytics_advanced, academic_agent, staff_assistant, workflow_agent, campus_assistant, voice,
integrations, whatsapp, sso, custom_domain.

## 6. What was built, phase by phase

### Phase 0 — Discovery and planning ✅
All planning docs: architecture, database schema, authorization, authentication, security, AI
architecture, deployment, roadmap (phases 0–17), testing, tenant isolation.

### Phase 1 — Foundation and design system ✅
- Public website, 10 pages in English and Arabic (RTL): home, product, features, solutions,
  pricing (no hard-coded prices), demo, about, contact (validated, not stored), privacy, terms
  (drafts). Platform branding from environment variables (white-label), theme engine.
- Auth pages, proxy, workspace and console shells, security headers, error pages, `/api/health`,
  robots.txt and sitemap (workspaces, console, auth and APIs excluded).

### Phase 2 — Auth, tenants, security foundation ✅ (verified live)
Migrations 1–5 applied to "agent"; live sign-in; isolation tests T1–T16 + escalation, ownership,
invitations, storage (80 DB tests at the time) and live HTTP tests (T18).

### Phase 3 — Super admin and university management ✅ (verified live 9/9)
- Platform console: universities list (counts only), create a university + owner invitation link,
  lifecycle status (trial/active/suspended/archived), per-university feature switches, support
  access grant/revoke, platform audit log.
- University workspace: members (roles, departments, suspend, remove), invitations, departments
  (en/ar), settings (names, default language, time zone, support email), branding draft → publish
  (colors with contrast checks, assistant names, welcome texts, monogram, logo PNG/JPEG/WebP
  ≤ 1 MB, content-sniffed, SVG refused), audit log viewer. Support sessions get a fixed read-only page set.

### Phase 4 — Knowledge base ✅ (verified live 6/6)
Upload PDF, DOCX, TXT, CSV (≤ 25 MB) with direct signed uploads; content must match the type
(magic bytes / UTF-8); extraction (Arabic PDFs rebuilt in reading order), normalization, chunking
(target 1,600 / max 2,400 chars, headings and page numbers kept), versioning, visibility
(public / members / staff / restricted to listed roles or departments), publish/archive/delete (files removed), scanned PDFs flagged
"needs OCR". Search: English + Arabic full-text; an embeddings hook exists but no provider is
configured (ADR-021).

### Phase 5 — Student assistant 🟡 (DB applied; no API key yet)
`/app/[tenant]/ask` chat and `/app/[tenant]/assistant` settings. Retrieval runs as the student
(only documents they may read); **no model call without passages**; Claude with citable
`search_result` blocks; numbered sources that open the cited page; "no sources" answer offers a
request; feedback (helpful / not helpful); streaming NDJSON endpoint `/api/assistant/[tenant]`;
monthly budget and per-person daily limit enforced in the database; eval suite `evals/assistant`
(13 cases incl. prompt injection and cross-tenant) — **not run yet**.

### Phase 6 — Admissions and leads 🟡 (DB applied)
Public page `/[lang]/admissions/[tenant]` (programs, program details, admissions assistant,
inquiry form with recorded consent: time, wording, version). Visitors use anonymous Supabase
sessions (must be enabled in Supabase Auth — currently off) and optional Cloudflare Turnstile.
Staff workspace: inquiries with filters, pipeline stages, assignment, notes, history, deletion on
request, programs, analytics, settings. Audited export of one inquiry (migration 12).

### Phase 7 — Tickets and human handoff 🟡 (migration 13 local)
"My requests" (new, thread, reply, close), staff queues by department, ticket page (reply, status,
priority, category, transfer, assignment, internal notes the requester never sees, history),
categories that route to departments, "Ask a person" from the chat with opt-in sharing of the
conversation, AI request draft and AI summary stored as a labelled internal note, in-app
notifications (bell + page).

### Phase 8 — Analytics and AI quality 🟡 (migration 14 local)
Analytics from stored rows only (assistants, knowledge gaps, tickets, knowledge base, admissions,
AI cost vs budgets, quality); AI quality page: reviewers handle unanswered and "not helpful"
exchanges one at a time, pseudonymized and redacted; last 7 days on the overview.

### Phase 9 — Academic assistant 🟡 (migration 15 local)
Courses with instructors (Faculty role) and student join codes; course materials through the
knowledge pipeline, readable only in the course; AI study aids (summaries, quizzes, flashcards,
study plans) per course switch, labelled AI-generated, private to each student; quiz answers kept
and graded in the database; class figures without individual results.

### Phase 10 — Staff assistant 🟡 (migration 16 local)
Questions over documents a staff member may read (internal included) with an optional department
filter that only narrows; AI drafts (emails, letters, announcements) with [placeholders], private,
never sent by the AI; ticket digest with contact details removed before the AI sees it; own
switch (off by default), guidance, budget, daily limit. Endpoint `/api/staff-assistant/[tenant]`.

### Phase 11 — Service request workflows 🟡 (migration 17 local)
Offices build forms (en/ar) as drafts, publish immutable versions; each request keeps its version;
confirmation step; tracking number `R-00001`; statuses in review / needs information / approved /
rejected / completed / cancelled; messages, internal notes, assignment, notifications both ways;
optional AI form suggestion that opens the right form pre-filled (never submits; off by default).

### Phase 12 — Campus map and assistant 🟡 (migration 18 local)
Directory with bilingual search, simple map drawn from coordinates (no third-party tiles; SVG kept
LTR), location pages (building, floor, weekly hours, "open now" in the university's time zone,
accessibility yes/no/not recorded, contacts), management (drafts until published), optional AI
campus answers from location records only.

### Phase 13 — Voice 🟡 (migration 19 local)
Dictation (fills the message box; the person still sends) and read-aloud in the student and staff
chats; provider `browser` works now (privacy notice shown); `server` provider interface with
endpoints `/api/voice/[tenant]/transcribe` and `/speak`, budget and daily limit — **no vendor
connected**; usage tracked separately (seconds, characters, people; no audio or text), priced with
the university's own contract prices; `docs/voice.md` compares vendors.

### Phase 14 — Notifications and integrations 🟡 (migration 20 local)
Per-person, per-kind preferences (in-app on, email off by default) at `/notifications/settings`;
email outbox storing references only (rendered at send time); `EmailSender` interface and a
delivery round with retries (5 attempts) — **no email provider connected**; integrations page
(email, LMS, SIS, messaging, webhook, SSO) with non-secret settings, a secret **name** only
(`secret_ref`), status (draft/active/paused/error) and log — **no connector built**.

### Phase 15 — Plans and subscriptions 🟡 (migration 21 local)
Platform pages `/platform/plans`, `/platform/plans/[planId]`, `/platform/tenants/[slug]/subscription`,
`/platform/usage`. Plans with features, limits (members, documents, monthly AI USD), trial and
grace days, optional price in any currency (minor units by the currency's decimals; none = "by
quote"). One subscription per university: trial / active / past_due / suspended / expired /
cancelled; assigning a plan sets the features; manual payments (bank transfer, cash, cheque,
card offline, other) that add months = renewal; `subscription_sweep()` moves statuses by date
(button "Check renewals now"; no scheduled job yet). Limits enforced by triggers (invitations,
memberships, documents) and a plan-wide AI cap inside every AI gate. Monthly usage report. Plan card
on the university's settings page. Universities without a plan keep working without limits.

### Phase 16 — Security review and hardening 🟡 (migrations 22–23 local)
Report `docs/security-review.md` (10 findings, all fixed or mitigated): voice was blocked by our own
Permissions-Policy (fixed), no MFA (TOTP built, DB-enforced), per-instance rate limits (shared),
spoofable client IP behind Cloudflare (`TRUSTED_IP_HEADER`), `'unsafe-inline'` on signed-in pages
(nonce CSP), pdf.js late rejection on damaged PDFs (guard, mitigated), PII in logs (redaction), one
private table without RLS (fixed), HSTS preload removed. Added: catalog coverage test, secret scanner
(files + git history), `npm audit` (0 vulnerabilities), upload fuzzing, two-step pages `/two-step`
and `/login/verify`, account-menu link. **Not done:** prompt-injection eval (needs key), backup
restore drill (needs production project; runbook written), MFA live test.

### Phase 17 — Demo, deployment readiness 🟡 (migration 24 local; nothing deployed)
Demo content + "Reset demo" in the platform console (demo universities only, audited); request
error reports via `onRequestError` (redacted JSON line, optional `ERROR_REPORT_URL`);
`/api/health?deep=1` (Supabase Auth reachability + version); GitHub Actions CI
(`.github/workflows/ci.yml`: typecheck, lint, unit, secret scan, audit, DB tests on
`pgvector/pgvector:pg16`, build, e2e); `docs/runbooks/deploy.md`, `docs/runbooks/backup-restore.md`,
`docs/launch-checklist.md`, `docs/demo-script.md` (en/ar).

## 7. Routes

- **Public:** `/[lang]` + 9 marketing pages; `/[lang]/admissions/[tenant]` and `/programs/[code]`.
- **Auth:** `/login`, `/login/verify`, `/register`, `/forgot-password`, `/reset-password`,
  `/invite/[token]`, `/two-step`; route handlers `/auth/callback`, `/auth/confirm`.
- **Workspace `/[lang]/app/[tenant]`:** overview, ask, assistant, courses (+ `[courseId]`, `manage`,
  `study/[itemId]`), academic, requests (+ new, `[ticketId]`), tickets (+ `[ticketId]`, categories),
  services (+ `new/[definitionId]`, `[requestId]`), workflows (+ `requests/[requestId]`, forms,
  `forms/[definitionId]`, settings), staff-assistant (+ drafts, `drafts/[draftId]`, tickets,
  settings), campus (+ `[locationId]`, manage, `manage/new`, `manage/[locationId]`, settings),
  voice, knowledge (+ `[documentId]`), admissions (+ leads, programs, analytics, settings),
  analytics, quality, notifications (+ settings), integrations (+ `[integrationId]`), members,
  departments, audit, settings (+ branding).
- **Platform `/[lang]/platform`:** overview (readiness), tenants (+ `[slug]`, `[slug]/subscription`),
  plans (+ `[planId]`), usage, audit; `ai` and `settings` are labelled planned (not built).
- **API:** `/api/assistant/[tenant]`, `/api/staff-assistant/[tenant]`, `/api/admissions/[tenant]`,
  `/api/admissions/[tenant]/leads/[leadId]/export`, `/api/voice/[tenant]/transcribe|speak`, `/api/health`.

**Links:** one domain; each university has its own path (`/ar/app/<slug>`, public admissions
`/ar/admissions/<slug>`); one sign-in, people see only their universities. Subdomain or the
university's own domain is **not built** yet (`tenant_domains` table and `custom_domain` feature exist).

## 8. Environment variables (`docs/environment-variables.md`)

`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_PLATFORM_NAME` / `_SHORT_NAME` / `_ASSISTANT_NAME` /
`_SUPPORT_EMAIL` / `_SALES_EMAIL` / `_PRIMARY_COLOR` / `_SECONDARY_COLOR` / `_ACCENT_COLOR`,
`SUPABASE_SECRET_KEY` (background jobs only), `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_EFFORT`,
`EMBEDDINGS_PROVIDER` / `_MODEL` / `_API_KEY`, `VOICE_PROVIDER`, `EMAIL_PROVIDER`,
`RATE_LIMIT_SECRET`, `TRUSTED_IP_HEADER`, `PLATFORM_MFA`, `ERROR_REPORT_URL`, `APP_VERSION`,
`LOG_LEVEL`, `UNIAGENT_UI_PREVIEW` (never in production), test-only `TEST_DATABASE_URL`,
`RUN_AI_EVALS`, `LIVE_E2E` and the `LIVE_*` accounts.

## 9. Tests and how to run them

| Command | What | Result now |
| --- | --- | --- |
| `npm run typecheck` · `npm run lint` · `npm run build` | types (after `next typegen`), lint, production build | ✅ |
| `npm test` | unit + component | ✅ 289 |
| `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:db` | all migrations on a throw-away database; RLS, isolation, functions, coverage | ✅ 306 |
| `npm run build && npx playwright test --trace off` | browser tests in preview mode, under the nonce CSP | ✅ 158 |
| `npm run security:secrets` · `npm run security:audit` | secret scan (files + history) · npm audit | ✅ clean · 0 |
| `RUN_AI_EVALS=1 ANTHROPIC_API_KEY=… npm run test:eval` | 13 student + 10 admissions AI cases (costs ~USD 0.15–0.50) | ⏸ not run |
| `LIVE_E2E=1 … npx playwright test e2e/live` | live runs against "agent" | ✅ Phase 3 9/9, Phase 4 6/6 (earlier) |

Local Postgres in this environment: `pg_ctlcluster 16 main start` (stops after restarts).

## 10. What is live, what is local, what is pending

- **Live on "agent":** migrations 1–11, the demo university "Northbridge", buckets
  `tenant-assets` and `tenant-documents`. 0 user accounts (test data cleaned up).
- **Local only (in git):** migrations 12–24 and all features of phases 7–17 that depend on them.
- **Not deployed anywhere.** No production URL exists.
- **Owner actions (see `docs/launch-checklist.md`):** apply migrations 12–24; configure Supabase
  Auth (site URL, redirect URLs, SMTP, email templates, TOTP on, anonymous sign-ins on, CAPTCHA,
  leaked-password protection); become platform owner (`bootstrap_platform_owner.sql`); set
  `ANTHROPIC_API_KEY` and approve the eval run; set `RATE_LIMIT_SECRET` (and `TRUSTED_IP_HEADER`
  behind Cloudflare); choose domains, paid plans (Vercel Pro, Supabase Pro), an email provider,
  optionally an embeddings provider and a speech vendor; **approve the first production deployment**;
  then smoke test, backup restore drill, uptime monitoring, a daily `subscription_sweep()` job.

## 11. Known limitations and open risks

- Email: nothing is sent (invitations show a link to copy; notification emails stay queued).
- No integration connector, no online payments or invoices, no subdomain/custom-domain routing,
  no OCR, no embeddings (full-text search only), no server speech vendor.
- Assistant turns, ticket AI usage, study aids and drafts are recorded with the user's own session
  (no service-role worker yet): a user calling the API directly could add records to their own
  items or understate usage.
- A damaged PDF can leave a late pdf.js rejection (logged by Next.js; guard in
  `src/lib/knowledge/pdf-guard.ts`); root cause not fixed.
- Two-step sign-in not tested against real Supabase Auth; `PLATFORM_MFA=optional` is the escape hatch.
- Per-email sign-in limit allows a targeted 10-minute lockout (Turnstile reduces it).
- Platform pages `ai` and `settings` still say "Planned · Phase 16" although Phase 16 is done —
  the label should change to a later phase or "after launch".
- Replaced logo files are not deleted from storage; anonymous visitor accounts are not cleaned up
  until migration 12 + a scheduled job.
- No visual check of the platform billing pages with real data.

## 12. Conventions to keep

- Next.js 16: read `node_modules/next/dist/docs/` before using an API; pages use
  `PageProps<'/route'>` / `LayoutProps`; run `npx next typegen` after adding routes; page files
  may not export anything but the page (put helpers in `lib`).
- Server Actions: `beginAction()` → `isActionContext` → zod `safeParse` (`formValues`) →
  `isRateLimited(kind, userId)` → `ctx.supabase.rpc(...)` → `dbFailure` / `errorState` /
  `successState` → `refresh()` or `redirect()`. Error keys live in `ACTION_ERRORS` and the
  management dictionaries; validation keys in `validation` (en and ar).
- Pages: `getI18n()`, `getWorkspaceContext(locale, slug)`, `requireWorkspaceAccess(ctx,
  {permission, feature})`, `writeMode(ctx, dict)` for read-only/preview notices;
  `ActionForm` / `ActionButton` / `FormField` components.
- Every new module: dictionaries in both languages with the same shape, nav item, DB tests
  (`supabase/tests/<module>.test.ts` with the harness actors `user`, `userAal2`, `anon`,
  `service`, `query`, `asCommitted`), unit tests, e2e preview tests incl. Arabic + axe, an ADR, and
  updates to `PROJECT_STATUS.md`, `TASKS.md`, `docs/database-schema.md`,
  `docs/tenant-isolation.md`, `docs/testing.md`, `docs/progress-log.md`, `supabase/README.md`.
- Visual checks: production build (`npm run build && npm start`), kill old servers first
  (`pkill -f next-server`); screenshots at deviceScaleFactor 2.
- Commits on branch `ccr-df7f375e-95dbtr`, ending with the attribution lines the session requires.

## 13. Possible next steps (owner decides)

1. Apply migrations 12–24 to "agent" and run the live checks (needs the owner's go-ahead).
2. A preview deployment on Vercel to try the product with real accounts (needs approval).
3. Subdomain / custom-domain routing per university.
4. Email provider adapter + scheduled sender; invitation emails.
5. Service-role background worker (usage booking, document processing, sweep, cleanups).
6. Relabel the platform `ai` / `settings` placeholders; build them when needed.

Final reminder: end every reply with ملخص قصير بالعربي.
