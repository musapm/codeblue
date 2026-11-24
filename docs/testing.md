# Testing Guide

## Commands

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | `next typegen` (route types) + `tsc --noEmit` |
| `npm run lint` | ESLint with Next.js core-web-vitals and TypeScript rules |
| `npm test` | Vitest unit and component tests (`src/**/*.test.ts(x)`) |
| `npm run check` | typecheck + lint + unit tests |
| `npm run build` | Production build (also type-checks) |
| `npm run test:e2e` | Playwright end-to-end tests against a **production build** (run `npm run build` first) |
| `npm run test:db` | Database tests on local PostgreSQL 16 (`TEST_DATABASE_URL`) |
| `npm run test:eval` | Live AI evals (`evals/`): skipped unless `RUN_AI_EVALS=1` and `ANTHROPIC_API_KEY` are set. **Costs money** (docs/ai-evals.md) |

## Unit and component tests (Vitest + Testing Library)

| File | Covers |
| --- | --- |
| `src/lib/safe-redirect.test.ts` | Open-redirect protection (`//evil`, `/\evil`, schemes, control characters, encoded slashes) |
| `src/lib/branding/theme.test.ts` | Hex validation (CSS-injection attempts), WCAG contrast, theme variables |
| `src/lib/logger.test.ts` | Secret and PII redaction, JSON output, levels, circular data |
| `src/lib/rate-limit.test.ts` | Sliding window, key isolation, memory bounds, client IP parsing |
| `src/lib/i18n/i18n.test.ts` | Locale helpers, Accept-Language negotiation, **Arabic/English dictionary parity** |
| `src/lib/core.test.ts` | Preview-mode guard, auth and contact schemas, env parsing, error mapping, navigation filtering, security headers |
| `src/codebase-guards.test.ts` | Static rules: no hardcoded product name, no server env in client components, `server-only` markers, secret-key usage |
| `src/components/ui/ui.test.tsx` | Button defaults, Field accessibility wiring, Avatar initials |

## End-to-end tests (Playwright)

Configured in `playwright.config.ts`. The web server starts with `UNIAGENT_UI_PREVIEW=true` and
**no Supabase**, so the suite checks:

- `e2e/marketing.spec.ts`: every public page in en and ar returns 200 with the correct `lang`/`dir`, no
  console errors, the locale redirect, the language switcher and its cookie, no hardcoded prices, the
  white-label theme switch, contact form validation and the honest "not stored" state, 404, security
  headers, axe accessibility (WCAG 2 A/AA, serious and critical), mobile navigation, and no horizontal overflow.
- `e2e/auth.spec.ts`: auth pages render the "not configured" state with inputs disabled, links,
  open-redirect rejection for `?next=`, the callback-error message, and that the callback never redirects off-site.
- `e2e/workspace.spec.ts`: workspace redirect, preview banner, navigation, honest module placeholders,
  not-found for unknown modules and tenants, the workspace switcher with tenant theme, the branding editor
  contrast checks, RTL workspace, platform readiness, and accessibility.

Projects: `desktop-chromium` (all tests except `@mobile`) and `mobile-chromium` (Pixel 7, `@mobile` tests).

The Chromium browser is pre-installed in this environment. `@playwright/test` is pinned to **1.63.0**,
and `playwright-core` is overridden to the same version, so they match that browser.

## Tests added in later phases

| Phase | Suite |
| --- | --- |
| 2 | **Tenant isolation / RLS suite** (T1–T15, T18 in `tenant-isolation.md`): SQL-level tests on PostgreSQL 16 with a Supabase-compatible `auth` shim, plus HTTP-level tests against Server Actions. Live auth e2e against a dev Supabase project |
| 4 | Ingestion (valid, invalid, large, and corrupt files), deletion, storage isolation (T16) |
| 5 | ✅ Built (see "Student assistant (Phase 5)" below). The live AI eval has not been run yet: it needs an API key and approval to spend |
| 16 | Security regression suite, load and abuse tests |

## Notes on HTTP status codes in authenticated areas

With Cache Components, `/app` and `/platform` stream after the root layout's static shell. A
`redirect()` or `notFound()` raised by the Data Access Layer is therefore delivered in the stream, and the
HTTP status stays 200. The protected content is **never rendered or sent**, and the client router performs
the redirect or shows the 404 UI. When Supabase is configured, `proxy.ts` additionally issues a real
**HTTP 307** to the login page for requests without a session. Tests assert on behaviour (URL and content),
not on status codes, for these routes.

## Database isolation tests (Phases 2–3)

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:db
```

`supabase/tests/rls.test.ts` (50 tests) creates a throw-away database, applies the Supabase shim and
every migration, and runs each check **as a real database role with Supabase-style JWT claims**, so
RLS, grants, constraints and triggers behave as they do behind the Supabase Data API. It covers
isolation tests **T1–T15** from `tenant-isolation.md`, plus escalation attempts, suspension, support
grants, the append-only audit log, API functions, integrity constraints and the demo seed.

`supabase/tests/management.test.ts` (30 tests, Phase 3) covers:
- invitations: hash-only storage, escalation rules, owner-role invitations, replacement, acceptance with a confirmed matching email, revoked/expired/unknown tokens, masked preview;
- member listing (including support grants);
- the last-owner guard and owner protection (ADR-018);
- profile and branding validation and publishing;
- platform overview functions;
- **T16**: tenant-scoped storage for brand assets.

Total: **80 tests**. Fixtures that later steps must see (invitations) use `asCommitted`; everything else rolls back.

## Live tests against a real Supabase project (opt-in)

`e2e/live/live-auth.spec.ts` covers real sign-in, role-based navigation, server-side enforcement of
direct URLs, **T18 (HTTP-level cross-tenant attempts)**, sign-out, the owner's settings and branding
from the database, Arabic tenant names, and the no-access page. It runs only with `LIVE_E2E=1`, a
build configured with that project's URL and key, and dedicated test accounts (see
`environment-variables.md`). Never point it at real users.

`e2e/live/live-management.spec.ts` (Phase 3) walks the onboarding path through the real UI and
database:
1. A platform admin creates a university and gets the owner invitation link. A duplicate address is refused.
2. The admin toggles a feature.
3. The owner signs in from the invitation and accepts. The link then reads "already used".
4. The owner invites a student, creates a department, edits settings, publishes branding with a logo (a disguised SVG is refused), and sees the theme in the shell and the entries in the audit log.
5. Another account cannot use the student's link.
6. The student accepts and gets "not found" on staff pages.
7. The owner suspends the student, who loses access.
8. Support access is granted, read-only, visible in the platform audit log, and revoked.
9. Suspending the university shows its members the unavailable screen.

It needs `LIVE_PLATFORM_*`, `LIVE_NEW_OWNER_*`, `LIVE_NEW_STUDENT_*`, `LIVE_OUTSIDER_*` and
`LIVE_NEW_TENANT_SLUG` (temporary accounts on the reserved `.test` domain), and a build with
`NEXT_PUBLIC_SITE_URL` set to the test server's URL (invitation links are built from it).

Live runs on 2026-11-22 against project "agent":
- **Phase 2 (`live-auth`)**:
  - first run: 6/6 passed;
  - after Phase 3: the 4 student/outsider cases passed again. The 2 owner cases need an owner in the demo university, and the owner guard (ADR-018) prevents deleting such a temporary account afterwards, so they were skipped. Use a dedicated test tenant for them in future.
- **Phase 3 (`live-management`)**: 9/9.
  - Steps 1–7 passed in one run.
  - Steps 8–9 passed after fixing a test selector and a real defect: support sessions had no visible pages (ADR-019).
  - The temporary accounts, test universities and test logo are removed after each run. The audit rows remain (append-only, fictional addresses only).

### Knowledge base (Phase 4)

- **Database:** `supabase/tests/knowledge.test.ts` (19 tests) covers:
  - the upload state machine, versioning and visibility rules;
  - publishing, archive/expiry and deletion;
  - T16 (originals in storage, including orphan cleanup);
  - T17 (search isolation and ranking);
  - Arabic normalization and hostile query text.
- **Unit:** `src/lib/knowledge/*.test.ts` covers the chunker, normalization, CSV, file signatures and PDF bidi reconstruction. `extract.test.ts` extracts real fictional fixtures in `src/lib/knowledge/__fixtures__/` (English and Arabic PDFs printed by Chromium, a scanned PDF, DOCX and broken DOCX).
- **Live:** `e2e/live/live-knowledge.spec.ts` needs `LIVE_KNOWLEDGE_TENANT_SLUG` (a university where `LIVE_NEW_OWNER_*` is owner) and `NEXT_PUBLIC_SUPABASE_*` in the environment for the student API check. Run on 2026-11-23: **6/6**.
  - The in-memory login rate limit (20 per 10 minutes per IP) can stop long local runs; restarting the server resets it.

### Student assistant (Phase 5)

- **Database:** `supabase/tests/assistant.test.ts` (9 tests): every gate (permission, feature, on/off switch, budget, question length), conversation privacy between students, owners and universities, usage accounting and the monthly budget, feedback, settings and the usage summary.
- **Unit:** `src/lib/ai/ai.test.ts` (prices, system prompt, follow-up retrieval, message layout with `search_result` blocks, citation mapping) and `src/lib/ai/assistant.test.ts` (the whole turn with a fake database and a fake Anthropic SDK: gates, no model call without passages, streamed answer with citations and recorded usage, knowledge gap, refusal, API failure). No network, no cost.
- **Browser (preview):** the chat and settings pages, disabled composer, Arabic RTL, accessibility, and the answer endpoint refusing cross-site requests (403) and doing nothing in preview mode (503).
- **Live AI eval:** `evals/assistant` (13 cases), see `docs/ai-evals.md`. Not run yet.
- **Not yet live-tested:** the chat against the real project "agent". Migration 10 is applied; the API key is still missing.

### Admissions (Phase 6)

- **Database:** `supabase/tests/admissions.test.ts` (28 tests), with an anonymous visitor actor (`visitor()` in the harness, claim `is_anonymous`): public page visibility, programs RLS and validation, inquiries (session, consent wording/version, contact, programs of the same university, daily limit), lead privacy, pipeline history, notes, staff-recorded inquiries, erasure without personal data in the audit log, analytics, assignees, the admissions assistant (switch, privacy, agent separation, budget per agent, daily limit) and public-only retrieval.
- **Unit:** `src/lib/admissions/admissions.test.ts` (program passages, program selection, consent wording, staff form validation, lead search sanitizing) and 4 admissions cases in `src/lib/ai/assistant.test.ts` (functions used, applicant rules, program citations, daily limit, no model call without sources). The CSP test covers Turnstile.
- **Browser (preview):** staff pages (inquiries, programs, analytics, settings) render honestly without data and offer no writes; navigation; Arabic; the public page is "not found" without a backend; the admissions endpoint refuses cross-site requests; accessibility of 3 pages.
- **Visual check:** the public page and the charts were rendered with fictional data through a temporary local-only route (deleted) and checked in English and Arabic.
- **Live (2026-11-23):** migration applied and byte-identical; `anon` cannot submit inquiries or read programs/leads; `public_admissions` returns `null` for the unpublished demo; anonymous sign-ins are disabled (`anonymous_provider_disabled`), so no visitor flow could run live yet.

### Phase 6 follow-ups

- **Database:** `supabase/tests/admissions-maintenance.test.ts` (6 tests, migration 12): a complete export without internal ids; refused without `leads.read`; every export audited with the reference only; the cleanup cannot be called through the API, refuses fewer than 7 days, and removes only anonymous visitors unused for the period, while inquiries (unlinked) and AI cost records stay. The auth shim now has `is_anonymous` and `last_sign_in_at`.
- **Unit / browser:** `robots.txt` and `sitemap.xml` (`src/app/seo.test.ts`, and 2 browser checks).
- **Admissions eval:** `evals/admissions` (10 cases), run with `npm run test:eval` (opt-in, costs money). A run with an invalid key confirmed the path; not run with a real key.
- **Live:** `e2e/live/live-admissions.spec.ts` is **written but not run**. It needs anonymous sign-ins enabled and `LIVE_ADMISSIONS_TENANT_SLUG` plus an owner account. The flow covers publishing the page and a program, a visitor inquiry with consent, the anonymous session being refused by the workspace, the pipeline, note, export and deletion, and cleanup.

### Tickets and handoff (Phase 7)

- **Database:** `supabase/tests/tickets.test.ts` (26 tests, migration 13, local only): routing by category and the general queue, who reads tickets, replies, notes and history, requester-as-staff, status rules (reply reopens, closed refuses), self-assignment versus `tickets.assign`, assignees limited to the queue's staff, the shared conversation cut-off, the daily request limit, the AI gate (budget, daily limit, permission), AI summaries as internal notes, notifications (never to the person who acted) and marking them read, other universities.
- **Unit:** `src/lib/tickets/tickets.test.ts` (10 tests): queues by permission, priority order, form validation, and the AI draft/summary with a fake model and database (no call without a key or over the budget/limit, low effort and structured output, the conversation treated as data, invented categories dropped, refusals recorded). `management.test.ts` covers the new error mapping (closed, daily limit, AI budget).
- **Browser (preview):** the queue, categories, my requests, new request and notifications pages render honestly without data and offer no writes; the header bell opens notifications; navigation shows "My requests" and "Tickets" as available; unknown or malformed ticket ids are "not found"; Arabic; accessibility of 4 pages.
- **Visual check:** the ticket thread, the ticket form and the new-request form (with the AI draft button and the share checkbox) were rendered with fictional data through a temporary local-only route (deleted) and checked in English and Arabic. The full staff ticket page with real data has **not** been seen yet; that needs migration 13 on a real project.
- **Not run:** any live test. Migration 13 is not applied.

### Analytics and AI quality (Phase 8)

- **Database:** `supabase/tests/analytics.test.ts` (25 tests, migration 14, local only).
  - Fixtures with known times and outcomes: two assistants, tickets, inquiries, documents, AI usage, a second university, and a university in UTC+14.
  - Permissions per section; the period boundary at the university's midnight; counts and medians; tickets per queue and category; the most cited documents the viewer may read; sections of features that are off.
  - Grouping and redaction of gaps. Answers withheld for restricted and deleted sources. Reviews (group, change, reopen, validation, visibility, kept out of the audit log). The helpers.
- **Unit:** `src/lib/analytics/analytics.test.ts` (7 tests): periods, honest shares, budget levels, number and duration formats, payload validation, review input. `core.test.ts`: a list of features means "any of them".
- **Browser (preview):** analytics and AI quality pages without data (no figures, periods, queues, no review buttons); the overview's notice; navigation; Arabic; the chat's review notice; accessibility of 3 pages.
- **Visual check:** the dashboard and the review queue were rendered with fictional data through a temporary local-only route (deleted) and checked in English and Arabic, including keyboard focus on a chart. It found a real defect: a formatting function passed to a client component, which only fails with data. It also found money shown as `$6.8`. Both are fixed.
- **Not run:** any live test. Migration 14 is not applied.

### Academic assistant (Phase 9)

- **Database:** `supabase/tests/academic.test.ts` (28 tests, migration 15, local only). Covered:
  - the Faculty member role; who creates and edits courses, and code uniqueness per term;
  - instructor assignment by e-mail; who sees a course, with the join code hidden;
  - enrollment: code formats, brute-force limit, closing and rotating, roster, removal;
  - materials through the real pipeline: teachers only, students published only, never knowledge-base roles or the general search; storage;
  - per-course and per-tool enablement; drafts for teachers only; the 120,000-character limit; budget and daily limit;
  - malformed study aids refused; privacy of study aids and answer keys; grading; progress;
  - class figures with the 5-student threshold; the academic overview and analytics; archiving; other universities; nothing in the audit log.
  `rls.test.ts` now counts 14 system roles.
- **Unit:** `src/lib/academic/academic.test.ts` (15 tests): study-plan dates, form input, progress, checks on model output (malformed quiz questions dropped, references mapped or dropped, plan slots), and generation with a fake model and database (no call without a key or when the database gate refuses, materials sent as cached data and escaped, low/medium effort, answer key saved, refusals and unusable output still book usage).
- **Browser (preview):** My courses and the academic admin without data and without writes; navigation; unknown courses and study aids "not found"; Arabic; accessibility of 2 pages.
- **Visual check:** the study-tool form, the quiz, flashcards and study plan were rendered with fictional data through a temporary local-only route (deleted), in English and Arabic.
- **Not run:** any live test (migration 15 not applied; generation needs the API key). The pages with real course data have been checked only through their parts.

### Staff assistant (Phase 10)

- **Database:** `supabase/tests/staff.test.ts` (16 tests, migration 16, local only). Covered:
  - the gate: permission, feature, switch, budget and daily limit, with their error codes; settings only with `assistant.configure` (and audited);
  - staff conversations kept apart from student ones (neither can continue the other);
  - department-scoped search: the filter narrows, never widens (restricted documents stay hidden);
  - drafts: validation (a body is required), private to the author, deletion by the author only;
  - the ticket digest: scopes (mine, my departments, one department, all only with `tickets.read_all`), never other departments' tickets or the caller's own requests, no requester identity or notes, invalid scopes refused;
  - usage booked as `staff_assistant`, the usage figures, and the staff agent and budget in analytics.
  `analytics.test.ts` now expects the staff agent and its cost key.
- **Unit:** `src/lib/staff/staff.test.ts` (18 tests): contact redaction (e-mail addresses, phone numbers and ids in Latin and Arabic-Indic digits; dates and ticket references kept), form input, and both tools with a fake model and database (no call without a key or when the gate refuses, the department filter passed to the search, passages escaped, only used sources saved, effort and token caps, refusals, unusable output and failed saves still book usage, ticket text redacted, unknown ticket references dropped). It also checks the staff prompt profile. `src/components/staff/staff.test.tsx` (3 tests): the digest's coverage line, labels and ticket links.
- **Browser (preview):** the four staff pages without data and without writes; navigation; unknown drafts "not found"; Arabic; the staff endpoint refusing cross-site requests; accessibility of 4 pages.
- **Visual check:** a draft, the ticket digest and the forms were rendered with fictional data through a temporary local-only route (deleted), in English and Arabic. It found a real defect: the digest said "Based on 75 open tickets" when it covered only 60 of them (fixed, with a component test).
- **Not run:** any live test (migration 16 not applied; the tools need the API key). There is no eval set for the staff tools yet.

### Service request workflows (Phase 11)

- **Database:** `supabase/tests/workflows.test.ts` (20 tests, migration 17, local only). Covered:
  - who manages forms; key uniqueness; 10 kinds of malformed fields refused; drafts hidden until published;
  - published versions cannot change; a new draft does not affect requesters; the old version refused after a new one is published (40001), while earlier requests keep theirs;
  - submission: tracking numbers, normalized answers, 8 kinds of invalid answers, archived forms, other universities;
  - visibility by requester, department, general queue and university;
  - the status flow, required messages, the requester's answer returning a request to review;
  - internal notes and assignments hidden from requesters; assignment rules; nobody processing their own request;
  - completion, cancellation and closed requests; notifications for both sides; deleting forms only without requests;
  - the suggestion gate (switch, daily limit, budget); analytics counts and cost; audit; the feature switch.
  `analytics.test.ts` now expects the workflow cost key.
- **Unit:** `src/lib/workflows/workflows.test.ts` (12 tests): answer and form rules (the same as the database's), dates, answer formatting in both languages, keys from labels, choices with Arabic labels, required status messages, and the form suggestion with a fake model and database (no call without a key or when the gate refuses; labels mapped to option values; invalid values, unknown keys and checkboxes dropped; required fields still missing listed; no form fits; refusals still book usage). `src/components/workflows/workflows.test.tsx` (2 tests): the review-and-confirm step and an AI pre-filled form. `core.test.ts`: workflows are no longer a placeholder.
- **Browser (preview):** the services page, the staff queue, forms and settings without data and without writes; navigation; unknown forms and requests "not found"; Arabic; accessibility of 4 pages. The planned-module test now uses the campus module.
- **Visual check:** the request form (AI pre-filled), its review step, the timeline and the form builder were rendered with fictional data through a temporary local-only route (deleted), in English and Arabic, on a production build (dev mode did not hydrate in this environment). It found two defects, both fixed: answers in a different script were aligned to the wrong side in right-to-left pages, and assignments were labelled "Internal note".
- **Not run:** any live test (migration 17 not applied; suggestions need the API key). There is no eval set for the form suggestion yet.

