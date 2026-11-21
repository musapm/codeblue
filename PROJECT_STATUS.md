# Project Status

_Last updated: 2026-11-21 (after the implementation audit: `docs/IMPLEMENTATION_AUDIT.md`)_

## Honest summary

UniAgent AI is currently a **well-structured foundation, not a working product**.

- **Database:** the dedicated Supabase project exists but has **no application tables**.
- **AI:** none. There is no model integration and no AI responses; all chat UIs are labelled illustrations.
- **Authentication:** code is connected to Supabase. Failure paths are verified against the live project. Success paths have never run, the Auth settings are not configured, and **sign-out is broken**.
- **Tenant isolation:** designed and documented, **not implemented** (no data exists yet).
- **Fictional data:** confined to UI preview mode and the marketing demo, and clearly labelled. No dashboard shows fabricated numbers.

| Phase | Status |
| --- | --- |
| 0: Discovery, architecture, planning | ✅ Complete |
| 1: Foundation & design system | ⚠️ Complete **except two defects found in the audit**: sign-out (broken) and the post-login dead end |
| 2: Auth, tenants & security foundation | ⏭ Next. Supabase project ready (empty) |
| 3–17 | Not started |

## Supabase

| Item | Value |
| --- | --- |
| Project | `agent` (dedicated to UniAgent) · ref `zijruhuvzxtuudsvnwgy` · `https://zijruhuvzxtuudsvnwgy.supabase.co` |
| Region | eu-central-1 (Frankfurt), permanent |
| Plan | **Free**: no backups or PITR. Upgrade before real data |
| State | 0 app tables, 0 migrations, 0 users. `vector`, `pgtap`, `pgmq`, `pg_cron`, `pgroonga` available but not installed |
| Advisor | 2 low-risk warnings on the pre-existing `public.rls_auto_enable()` (revoke EXECUTE in the first migration) |
| Auth settings | **Not configured or verified** (Site URL, redirect URLs, SMTP, templates, sign-up policy) |
| Other projects | CodeBlue and Terma are in a different organization: **not accessed, not modified** |

## Feature status (see the audit for files, risks and next steps)

### 1. Fully implemented and working
- Public website, 10 pages in English and Arabic (copy needs "Coming soon" labels; see the defects below).
- Arabic/English switching with RTL.
- Platform branding configuration and theme engine (env-based).
- Locale routing and session gate: HTTP 307 to login verified **live** against "agent".
- Security baseline: headers, redirect guard, validation, redaction, `server-only` boundaries.
- Error pages and boundaries, health endpoint.
- Responsive layout (tested on mobile for key pages).

### 2. Implemented but not connected to a real backend
- Workspace shell and navigation (preview fixtures only).
- Tenant context (preview fixtures only; real users get "not found").
- Branding editor (live preview, **nothing persists**).
- Contact/demo form (validates, **nothing stored or sent**).
- Permission catalog and navigation filtering (**no enforcement anywhere yet**).
- Rate limiting (in-memory, per instance, IP from a spoofable header).
- Platform readiness panel (2 of 5 rows hardcoded as "Planned").

### 3. UI-only / placeholder
17 module placeholders · chat previews (static) · white-label demo (fictional universities) ·
Settings → General (read-only fixtures) · overview setup checklist (static) · Privacy/Terms (drafts).

### 4. Planned but not implemented
Database schema and migrations · tenant isolation (RLS) · role enforcement · Super Admin (no
`platform_admins`, no owner bootstrap) · departments and routing · AI integration · student, admissions,
academic and staff assistants · knowledge base upload and processing · RAG · citations · tickets and
handoff · analytics · branding persistence · audit logs · notifications and transactional email ·
backups and recovery · CI, monitoring and error tracking.

### 5. Broken or incomplete
| # | Issue | Severity |
| --- | --- | --- |
| 5.1 | **Sign-out does nothing.** The form is detached when the dropdown closes ("Form submission canceled because the form is not connected") | High |
| 5.2 | **Real users hit a dead end after login:** a misleading "not found" message and no sign-out on `/app`. `/platform` returns 404 for everyone real | High |
| 5.3 | Sign-up, sign-in and reset success paths have never been executed. Supabase Auth URLs, SMTP and templates are not configured | High |
| 5.4 | Auth settings cannot be read by the tooling; they must be checked in the dashboard | Medium |
| 5.5 | Marketing copy describes roadmap features in the present tense | Medium (commercial/legal) |
| 5.6 | Hardcoded: tenant timezone `Africa/Khartoum` and default locale, the platform "back" link to the demo slug, example.com emails | Low–Medium |
| 5.7 | Duplicate `id="main"` after some client navigations (skip-link target) | Low |

## Test results (commit `136cba1`)

| Check | Result | Note |
| --- | --- | --- |
| Typecheck / lint / build | ✅ | |
| Vitest | ✅ 81/81 | |
| Playwright | ✅ 56/56 | **Gap: no sign-out test, which is why 5.1 went undetected.** No success-path auth tests |
| `npm audit` (prod + dev) | ✅ 0 vulnerabilities | |
| Live checks against "agent" (audit) | ✅ 307 gate, wrong-password (en/ar), bad code/OTP, reset without session · ❌ sign-out | No data created |

## Security posture
- **Gate:** no real university data may be onboarded until Phase 2 isolation tests pass.
- High before launch: sign-out, shared rate limiting, backups (paid plan).
- Medium: CSP `'unsafe-inline'`, Auth configuration, marketing claims.
- Verified OK: no secrets in the repo, no unsafe HTML or eval, Host-header-safe auth links, preview mode disabled when Supabase is configured.

## Decisions needed from the product owner
1. **Transactional email provider** for auth emails (e.g. Resend, Postmark, Amazon SES). Supabase's default sender is not suitable for real users.
2. **Sign-up policy:** open self-registration, or invitation / approved university email domains only? Recommended: invitation and approved domains only.
3. **Plan upgrade timing:** the Free plan has no backups. Upgrade before any real university data (pilot).
4. Confirm that Frankfurt (eu-central-1) is acceptable for your target universities' data-residency requirements.

## Next steps (in order)
1. P0 fixes: sign-out, post-login page, "Coming soon" labels, Supabase Auth configuration.
2. Phase 2 in project "agent": migrations + RLS + isolation tests (gate), RLS-backed tenant context, platform-owner bootstrap, live auth e2e.
3. Shared rate limiting, CI, error tracking. Backups before real data.
