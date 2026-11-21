# API Reference

UniAgent AI uses **Server Actions** for form mutations and **Route Handlers** for HTTP endpoints.
Every mutation re-validates input (zod) and re-checks the session on the server.

## Route handlers

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /api/health` | None | Liveness and readiness. Returns `{ status, time, checks: { supabase: 'configured' \| 'not_configured' } }`. Sends `Cache-Control: no-store` and contains no secrets |
| `GET /auth/callback?code&next` | None (one-time code) | Exchanges a PKCE code for a session (email confirmation, password recovery), then sends a 303 to `next` (same-origin paths only) or to `/<locale>/login?error=link` |
| `GET /auth/confirm?token_hash&type&next` | None (one-time token) | Verifies an email OTP `token_hash` (works across browsers). Same redirects as above |

## Server actions

| Action | Module | Input (form fields) | Result |
| --- | --- | --- | --- |
| `signIn` | `src/lib/auth/actions.ts` | `email`, `password`, `locale`, `next?` | Redirects on success; otherwise `{ status: 'error', error?, fieldErrors? }` |
| `signUp` | same | `fullName`, `email`, `password`, `locale` | `{ status: 'success' }` (generic, no account enumeration) or an error |
| `requestPasswordReset` | same | `email`, `locale` | Always `success` unless validation fails, the request is rate limited, or auth is not configured |
| `updatePassword` | same | `password`, `confirmPassword`, `locale` | Requires a recovery session; redirects to the app |
| `signOut` | same | `locale` | Signs out and redirects to login |
| `submitInquiry` | `src/lib/contact/actions.ts` | `name`, `email`, `organization`, `role?`, `country?`, `message`, `consent` | **Phase 1:** `{ status: 'not_stored', mailto }`. Nothing is stored or sent. Phase 2 persists consented inquiries |

Error results use **message keys** (for example `invalidCredentials`), not raw provider errors. The UI
translates them, so internal details never reach the browser.

## Conventions for future endpoints

- Validate with zod, derive the tenant from the URL slug and membership (never from the body alone), and
  query with the user's JWT so RLS applies.
- Return `{ error: { code, referenceId } }` built by `toPublicError()`, with the matching HTTP status.
- Rate-limit public and AI endpoints, and audit sensitive mutations.
