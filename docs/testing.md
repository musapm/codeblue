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
