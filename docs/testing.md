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
| 5 | AI evaluation suite (grounding, citations, Arabic/English/mixed, injection, cross-tenant probes); retrieval isolation (T17) |
| 16 | Security regression suite, load and abuse tests |

## Notes on HTTP status codes in authenticated areas

With Cache Components, `/app` and `/platform` stream after the root layout's static shell. A
`redirect()` or `notFound()` raised by the Data Access Layer is therefore delivered in the stream, and the
HTTP status stays 200. The protected content is **never rendered or sent**, and the client router performs
the redirect or shows the 404 UI. When Supabase is configured, `proxy.ts` additionally issues a real
**HTTP 307** to the login page for requests without a session. Tests assert on behaviour (URL and content),
not on status codes, for these routes.

## Database isolation tests (Phase 2)

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:db
```

`supabase/tests/rls.test.ts` (50 tests) creates a throw-away database, applies the Supabase shim and
every migration, and runs each check **as a real database role with Supabase-style JWT claims**, so
RLS, grants, constraints and triggers behave as they do behind the Supabase Data API. It covers
isolation tests **T1–T15** from `tenant-isolation.md`, plus escalation attempts, suspension, support
grants, the append-only audit log, API functions, integrity constraints and the demo seed.

## Live tests against a real Supabase project (opt-in)

`e2e/live/live-auth.spec.ts` covers real sign-in, role-based navigation, server-side enforcement of
direct URLs, **T18 (HTTP-level cross-tenant attempts)**, sign-out, the owner's settings and branding
from the database, Arabic tenant names, and the no-access page. It runs only with `LIVE_E2E=1`, a
build configured with that project's URL and key, and dedicated test accounts (see
`environment-variables.md`). Never point it at real users.

Last live run: 2026-11-22 against project "agent". **6/6 passed.** A platform owner without a
support grant was also confirmed to get "not found" on a university workspace. The temporary test
accounts and tenant were deleted afterwards.
