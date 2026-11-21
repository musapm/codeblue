# Authentication

## 1. Provider

**Supabase Auth**, integrated through `@supabase/ssr` so sessions live in HTTP-only cookies and work
with Server Components, Server Actions, Route Handlers, and `proxy.ts`.

| Method | Phase | Notes |
| --- | --- | --- |
| Email + password | 1 (UI), 2 (live) | Password policy: 10–72 characters (bcrypt limit); checked against common-password rules in Phase 16 |
| Email confirmation | 2 | PKCE + `token_hash` via `/auth/confirm` |
| Password reset | 1 (UI), 2 (live) | Always returns a generic message (no account enumeration) |
| Invitations | 2–3 | Tenant admin invites staff by email with a role |
| Magic link / OTP | Later | Same `/auth/confirm` route |
| Anonymous sessions | 5–6 | Supabase anonymous sign-in for public admissions chat. Gives RLS a `uid` and allows rate limiting per visitor |
| SSO (SAML / Microsoft Entra / Google Workspace) | Later (Enterprise) | Supabase SSO; mapped to tenants via verified domains |
| MFA (TOTP) | Phase 16 | Required for platform admins and recommended for tenant admins |

## 2. Flows

```
Sign in:   form → Server Action signIn() → supabase.auth.signInWithPassword()
           → session cookies set → redirect to a safe `next` path or /{lang}/app

Sign up:   form → signUp() → supabase.auth.signUp({ emailRedirectTo: /auth/confirm })
           → "check your email" → link → /auth/confirm?token_hash&type=signup&next
           → verifyOtp() → redirect

Reset:     form → requestPasswordReset() → resetPasswordForEmail()
           → generic success message regardless of whether the account exists
           → email link → /auth/confirm?type=recovery&next=/{lang}/reset-password
           → reset form → updateUser({ password }) → redirect to the app
```

## 3. Session handling

- `proxy.ts` calls `supabase.auth.getClaims()` on matched requests to **refresh the session cookie**.
  It redirects unauthenticated users away from `/app` and `/platform`. This is an optimistic UX check, not authorization.
- The **Data Access Layer** (`src/lib/auth/session.ts`) calls `supabase.auth.getUser()`, which is
  verified with the Auth server, before any data access. Every Server Action re-checks the session
  instead of relying on the page that rendered the form.
- Cookies are `HttpOnly`, `Secure` (production), and `SameSite=Lax`, managed by `@supabase/ssr`.
- Under Cache Components, session reads happen inside `<Suspense>` boundaries, or in segments marked
  `export const instant = false`. Session data is never placed in a shared `use cache` scope.

## 4. Safety rules

- **Open-redirect prevention:** every `next`/`redirectTo` parameter passes through `safeRedirectPath()`,
  which allows only same-origin relative paths. See its unit tests.
- **Rate limiting:** sign-in, sign-up, and reset actions are rate limited per IP and email. This is
  in-memory in Phase 1 and moves to a shared store before production. Supabase also applies its own limits.
- **Generic errors:** "Invalid email or password" never reveals whether the account exists.
- **Server-only secrets:** only `NEXT_PUBLIC_SUPABASE_URL` and the publishable (anon) key reach the browser.

## 5. Configuration state

If the Supabase variables are not set, the auth pages render a clear **"Authentication is not configured
for this environment"** notice, and the actions refuse to run. Nothing pretends to sign you in.

**UI preview mode** (`UNIAGENT_UI_PREVIEW=true`) lets the dashboard shell be viewed during development.
It is honoured **only when Supabase is not configured**, so no real data or backend exists to expose. It
shows a permanent banner, and it switches off automatically as soon as Supabase credentials are present.
