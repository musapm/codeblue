# Environment Variables

Copy `.env.example` to `.env.local` for local development. Set variables in your hosting provider's
dashboard for deployed environments. **Never commit real values.** `.env*` files are git-ignored,
except `.env.example`.

## Public variables (`NEXT_PUBLIC_*`)

These are **inlined into the JavaScript bundle at build time**. Changing them requires a rebuild,
and they are visible to anyone. Never put secrets here.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Production: **yes** | `http://localhost:3000` | Absolute base URL for auth email links and metadata. Auth redirects use this, never the request `Host` header, to prevent reset-link poisoning |
| `NEXT_PUBLIC_SUPABASE_URL` | Phase 2+ | — | Supabase project URL. Without it, auth pages show "not configured" |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Phase 2+ | — | Supabase publishable key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as a fallback |
| `NEXT_PUBLIC_PLATFORM_NAME` | No | `UniAgent AI` | Product name shown everywhere (white-label) |
| `NEXT_PUBLIC_PLATFORM_SHORT_NAME` | No | first word of the name | Compact name |
| `NEXT_PUBLIC_PLATFORM_ASSISTANT_NAME` | No | `<name> Assistant` | Default assistant name |
| `NEXT_PUBLIC_PLATFORM_SUPPORT_EMAIL` | Production: yes | `support@example.com` | Shown in the privacy policy and support links |
| `NEXT_PUBLIC_PLATFORM_SALES_EMAIL` | Production: yes | `sales@example.com` | Contact page and inquiry mailto links |
| `NEXT_PUBLIC_PLATFORM_PRIMARY_COLOR` / `_SECONDARY_COLOR` / `_ACCENT_COLOR` | No | `#1b4f8f` / `#0f2a4a` / `#b7862c` | Platform theme. Must be hex. Invalid values fall back to the defaults |

## Server-only variables

Read at runtime by server code (`src/lib/env/server.ts`, a `server-only` module). Never sent to the browser.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |
| `UNIAGENT_UI_PREVIEW` | No | `false` | Shows the workspace with a fictional identity **only when Supabase is not configured** (ADR-012). Do not set it in production |
| `SUPABASE_SECRET_KEY` | Phase 4+ | — | Service-role key for background jobs only. **Bypasses RLS.** Never use it in request handlers |
| `ANTHROPIC_API_KEY` | Phase 5+ | — | Default chat model provider (planned) |

## Validation

Both env modules validate with zod at startup. Invalid values raise an error that names the variable,
**never its value**. See the tests in `src/lib/core.test.ts`.

## Where to set them

| Environment | Location |
| --- | --- |
| Local | `.env.local` |
| Vercel | Project → Settings → Environment Variables (separate values per Preview and Production) |
| Cloudflare | `wrangler secret put` for secrets, `vars` in `wrangler.toml` for public values (if that host is chosen) |
| CI | Repository secrets |

## Test-only variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `npm run test:db` | Superuser connection to a **disposable** PostgreSQL server. The suite creates and drops its own temporary database |
| `LIVE_E2E=1` | `e2e/live` | Enables the live suite (otherwise skipped) |
| `LIVE_STUDENT_EMAIL` / `_PASSWORD`, `LIVE_OWNER_EMAIL` / `_PASSWORD`, `LIVE_OUTSIDER_EMAIL` / `_PASSWORD` | `e2e/live` | Dedicated test accounts in the target project (never real users) |
| `LIVE_OTHER_TENANT_SLUG` | `e2e/live` | A tenant the test accounts do not belong to (cross-tenant checks) |
