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
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Recommended with public admissions | — | Cloudflare Turnstile site key (public). Shows the check on sign-in, sign-up, reset and visitor sessions, and allows Cloudflare in the CSP. Set it together with CAPTCHA protection in Supabase Auth (docs/authentication.md step 8) |
| `VOICE_PROVIDER` | No (Phase 13) | — | Server speech vendor for voice. No adapter is registered yet, so any value leaves the server provider "not configured" (docs/voice.md). The vendor's key will be a separate secret |
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
| `EMBEDDINGS_PROVIDER` | No | — | `voyage` or `openai`. Unset → full-text search only (ADR-021) |
| `EMBEDDINGS_MODEL` | With a provider | — | Embedding model id |
| `EMBEDDINGS_API_KEY` | With a provider | — | Embedding provider key. **Secret** |
| `ANTHROPIC_API_KEY` | For the assistant | — | Claude API key. Unset → the assistant shows "not configured" and makes no calls. **Secret** |
| `AI_MODEL` | No | `claude-opus-5-5` | Model id for the student assistant. Re-run the evals (docs/ai-evals.md) before changing it |
| `AI_EFFORT` | No | `medium` | `low`, `medium`, `high`, `xhigh` or `max`. Higher effort costs more output tokens |
| `RUN_AI_EVALS` | No | — | `1` lets `npm run test:eval` call the Claude API (costs money). Never set it in production |

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
| `LIVE_PLATFORM_EMAIL` / `_PASSWORD`, `LIVE_NEW_OWNER_EMAIL` / `_PASSWORD`, `LIVE_NEW_STUDENT_EMAIL` / `_PASSWORD` | `e2e/live/live-management.spec.ts` | Temporary platform admin and two accounts without memberships (Phase 3 onboarding run) |
| `LIVE_NEW_TENANT_SLUG` | `e2e/live/live-management.spec.ts` | Slug of the university the run creates (must not exist) |
