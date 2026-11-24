# Runbook: first production deployment

> Status: written in Phase 17. **Nothing has been deployed.** Each step that changes an external
> service needs the product owner's go-ahead. Recommended topology: `docs/deployment.md` (Vercel for
> the app, Supabase for data and sign-in, Cloudflare in front for DNS and protection).

## 0. Before you start (owner decisions)

- [ ] Domain names (marketing site and `app.` host).
- [ ] Paid plans: Vercel Pro (commercial use), Supabase Pro (point-in-time recovery, no pausing).
- [ ] Email provider for sign-in emails (Supabase SMTP) and notification emails (ADR-034).
- [ ] Production Supabase project: a **new dedicated** project for production, or promote "agent"
      after the go-live checks. Never share it with other products.

## 1. Database

1. Apply migrations in order (12 → 24 are pending on "agent"):
   `supabase link --project-ref <ref>` then `supabase db push`, or apply each file in
   `supabase/migrations/` in the SQL editor in name order.
2. Run `supabase/seed/bootstrap_platform_owner.sql` after you sign up (makes you platform owner).
3. Optional demo: `supabase/seed/demo_northbridge.sql` (fictional university, marked as demo).
4. Authentication settings (dashboard): site URL, redirect URLs (`/auth/callback`, `/auth/confirm`),
   SMTP, email templates (`docs/authentication.md`), **TOTP enabled** (two-step sign-in), anonymous
   sign-ins **on** if public admissions are used, Turnstile secret if CAPTCHA is used.
5. Check: `select count(*) from supabase_migrations.schema_migrations;` equals the number of files.

## 2. App (Vercel)

1. Import the GitHub repository; framework Next.js; Node 22.
2. Environment variables (Production): see `docs/environment-variables.md`. At least
   `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `ANTHROPIC_API_KEY`, `RATE_LIMIT_SECRET` (32+ random characters), `TRUSTED_IP_HEADER`
   (`cf-connecting-ip` behind Cloudflare), `PLATFORM_MFA=required`. Optional:
   `ERROR_REPORT_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, embeddings and voice keys.
   **Never** set `UNIAGENT_UI_PREVIEW` in production.
3. Deploy the `main` branch after CI is green.

## 3. Edge (Cloudflare)

1. DNS for both hosts, proxied. SSL mode "Full (strict)".
2. Only Cloudflare should reach the origin if `TRUSTED_IP_HEADER=cf-connecting-ip` is used
   (otherwise keep the default `x-forwarded-for`).
3. WAF rate rules on `/api/*` and the sign-in page as a second line of defence.

## 4. Verify (smoke test, about 20 minutes)

- [ ] `GET /api/health?deep=1` → 200 with `auth: ok` and the deployed version.
- [ ] Response headers on `/en/app/...`: a CSP with a nonce; on `/en/pricing`: the static CSP.
- [ ] Sign up, confirm the email, sign in; set up two-step sign-in; sign out and in with a code.
- [ ] Platform console opens only after two-step sign-in is set up.
- [ ] Create a university, invite its owner, accept the invitation.
- [ ] Upload a PDF to the knowledge base, publish it, ask the student assistant about it.
- [ ] Public admissions page: an inquiry with consent; the admissions assistant answers.
- [ ] A request (ticket) end to end; a service request end to end; the campus directory.
- [ ] Assign a plan, record a payment, run "Check renewals now".
- [ ] Reset the demo university from the platform console.
- [ ] Logs: no personal data in the request-error lines; an error appears at `ERROR_REPORT_URL`.

## 5. Monitoring

- Uptime check every minute on `/api/health?deep=1` (any uptime service), alerting on two failures.
- Request errors: the host's log stream (one JSON line per error, `msg: request.error`), and
  `ERROR_REPORT_URL` if set.
- Scheduled jobs to add: `subscription_sweep()` daily, the email sender (ADR-034) when chosen.

## 6. Rollback

- App: promote the previous deployment in Vercel (instant).
- Database: forward-fix migrations; point-in-time recovery as the last resort
  (`docs/runbooks/backup-restore.md`).
