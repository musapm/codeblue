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
