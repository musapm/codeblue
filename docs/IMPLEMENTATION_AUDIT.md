# Implementation Audit

_Date: 2026-11-21 · Commit audited: `136cba1` · Auditor: engineering (Claude Code)_

> **Update 2026-11-22: what changed since this audit** (the original audit below is kept as a record).
>
> | Audit item | Now |
> | --- | --- |
> | 5.1 Sign-out broken | ✅ **Fixed.** The form lives outside the dropdown. e2e regression test added; verified live |
> | 5.2 Post-login dead end | ✅ **Fixed.** An honest "No university access yet" page with sign-out. Suspended universities get an "unavailable" page |
> | 5.5 Marketing overstates availability | ✅ **Fixed.** Site-wide "in development / pilot" notice, "In development" badges on agents and features, claims reworded |
> | 5.6 Hardcoded tenant time zone and locale, demo back-link | ✅ **Fixed.** Values now come from the database (`tenants.timezone`, `default_locale`). The console back-link uses the user's real workspaces |
> | Database schema / migrations (Cat. 4) | ✅ **Implemented.** 7 migrations in git, applied to "agent" and verified byte-identical |
> | Tenant isolation / RLS (Cat. 4) | ✅ **Implemented and tested.** 80 DB tests (T1–T16) + live T18 |
> | Role enforcement (Cat. 4) | ✅ In the database (RLS) and in the app (server-side gates on settings, branding and modules) |
> | Super Admin access (Cat. 4) | ✅ `platform_admins` + console gate + one-time bootstrap script. Platform staff need audited grants to see university content |
> | Departments (Cat. 4) | ✅ Management UI (Phase 3), verified live. **Ticket routing not built** (Phase 7) |
> | Audit logs (Cat. 4) | ✅ Database-enforced, append-only triggers. Tenant and platform viewers (Phase 3) |
> | University management (Phase 3) | ✅ Platform console, invitations, members & roles, settings, branding publish + logo, support-access UI. Verified live 9/9. **Missing:** invitation email, custom roles, sign-up domains |
> | 2.1/2.2 Workspace and tenant context on fixtures | ✅ Real data for signed-in users. Preview fixtures only when no backend is configured |
> | 5.3/5.4 Auth success paths, Auth config | ⚠️ Password sign-in and sign-out verified live. **Email flows still need your Supabase Auth settings + SMTP** (see `docs/authentication.md`) |
> | Knowledge base (Phase 4, 2026-11-23) | ✅ Implemented and verified live 6/6. Embeddings wait for a provider key (ADR-021) |
> | AI integration, RAG, citations, student assistant (Phase 5, 2026-11-23) | 🟡 **Implemented and tested locally** (fake model + local DB). Migration 10 is applied to "agent"; no API key is set, so it does not answer yet. The live eval has not run. Marketing chat previews remain labelled illustrations |
> | Other assistants, tickets, analytics, backups | ❌ Not implemented (later phases); backups need a paid plan. Branding persistence is now done |

This audit describes what the code **actually does today**. It does not describe what the UI suggests
or what the design documents plan. Every claim below comes from reading the code, running the
application, or querying the Supabase project.

## 1. Method and evidence

| Check | How | Result |
| --- | --- | --- |
| Data access in code | Searched for `.from(`, `.rpc(`, `.storage` and `fetch(` across `src/` | **0 database queries, 0 storage calls, 0 outbound fetches** |
| Supabase usage | Listed every `supabase.auth.*` call | 9 auth calls (sign-in, sign-up, reset, update password, sign-out, getUser, getClaims, code exchange, OTP verify). Nothing else |
| AI integration | Searched code and `package.json` for AI SDKs and providers | **None.** No AI SDK installed, no API key variable read, no model calls |
| Migrations | Looked for `supabase/` | **Does not exist** |
| Supabase project "agent" | Read-only queries via the Supabase connector (tables, migrations, extensions, advisors, organization plan) | Empty project. See §2 |
| Live auth behaviour | Built the app against project "agent" (public key passed as env vars only, nothing written to the repo) and ran non-mutating checks | Proxy redirect ✔, wrong-password sign-in ✔ (en/ar), bad callback code ✔, bad OTP ✔, reset without session ✔. No users created |
| Sign-out | Browser test in preview mode | **Broken.** See §4, item 5.1 |
| Automated tests | Unit, component and e2e suites at this commit | 81/81 unit, 56/56 e2e pass. They do **not** cover sign-out or any success path against a real backend |
| Dependencies | `npm audit` (prod and dev) | 0 known vulnerabilities |
| Unsafe patterns | Searched for `dangerouslySetInnerHTML`, `eval(` | None |

## 2. Supabase project "agent" (dedicated to UniAgent)

| Item | Finding |
| --- | --- |
| Project | `agent` · ref `zijruhuvzxtuudsvnwgy` · URL `https://zijruhuvzxtuudsvnwgy.supabase.co` |
| Organization | Separate organization from the CodeBlue and Terma projects. Those projects are no longer visible to this connector and were **not accessed or modified** |
| Region | `eu-central-1` (Frankfurt). Fixed for the life of the project |
| Plan | **Free**. Paid-plan features such as daily backups and point-in-time recovery are not available, and free projects pause after a period of inactivity. Confirm current terms on Supabase's pricing page |
| Postgres | 17 |
| Application tables | **None** (the `public` schema is empty). Only Supabase's built-in `auth`, `storage`, `realtime` and `vault` schemas exist |
| Auth users | 0 |
| Migrations | 0 |
| Installed extensions | `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault` |
| Available, not installed | `vector` 0.8.2 (pgvector, needed for RAG), `pgtap` (database tests), `pgmq` (queue), `pg_cron`, `citext`, `pg_trgm`, `pgroonga` (multilingual full-text search, including Arabic) |
| Security advisor | 2 warnings for a pre-existing function, `public.rls_auto_enable()`. It belongs to Supabase's "auto-enable RLS" event trigger (`ensure_rls`), which is useful, but EXECUTE is granted to `anon`/`authenticated`. Low risk (an event-trigger function cannot be called over RPC). Revoke EXECUTE in the first migration |
| Auth configuration | **Not verifiable through the connector.** Site URL, redirect allow-list, SMTP and email templates must be checked in the dashboard. Defaults will not work for production flows (see 5.3) |

## 3. Summary by category

| Category | Count | Items |
| --- | --- | --- |
| 1. Fully implemented and working | 7 | Public website · Arabic/English + RTL · Platform branding config and theme engine · Locale routing + session gate (proxy/DAL) · Security baseline · Error handling basics · Responsive layout (tested scope) |
| 2. Implemented but not connected to a real backend | 7 | Workspace shell and navigation · Tenant context · Branding editor · Contact/demo form · Permission catalog and nav filtering · Rate limiting · Platform readiness panel |
| 3. UI-only / placeholder | 6 | 17 module placeholders · Chat previews · White-label demo · Settings → General · Overview setup checklist · Privacy/Terms drafts |
| 4. Planned but not implemented | 19 | Database schema · Tenant isolation (RLS) · Roles enforcement · Super Admin · Departments and routing · AI integration · Student, Admissions, Academic and Staff assistants · Knowledge base · RAG · Citations · Tickets and handoff · Analytics · Branding persistence · Audit logs · Notifications and email · Backups and recovery · CI and monitoring |
| 5. Broken or incomplete | 7 | **Sign-out (broken)** · **Post-login dead end** · Sign-up/sign-in/reset success paths unverified · Supabase Auth not configured · Marketing copy overstates availability · Hardcoded assumptions · Duplicate landmark ids after some navigations |

**Bottom line:** UniAgent today is a well-structured foundation with a strong security design, not
a working product. The only real backend integration is authentication. Its failure paths are verified
against the live project, its success paths have never run, and sign-out is broken. **There is no
database, no tenant data, no AI, and no hardcoded data posing as real data inside the product.** The
fictional data is clearly labelled and confined to preview mode and the marketing demo.

---

## 4. Feature-by-feature findings

Format per feature: **Status** · Files · Works · Missing · Dependencies · Risks · Next step.

### Category 1: Fully implemented and working

**1.1 Public marketing website (10 pages × en/ar)**
- Files: `src/app/[lang]/(marketing)/*`, `src/content/marketing/*`, `src/components/marketing/*`
- Works: all pages render statically and return 200 in both languages. No console errors. Axe shows no serious or critical issues on the pages tested. No fake testimonials, logos or statistics. No prices.
- Missing: `robots.txt` and sitemap. Marketing copy describes roadmap features in the present tense (see 5.5).
- Dependencies: none.
- Risks: the copy may be read as product claims (see 5.5).
- Next step: label each feature "Available" or "Coming soon" before showing the site to universities.

**1.2 Arabic/English switching and RTL**
- Files: `src/lib/i18n/*`, `src/components/i18n/language-switcher.tsx`, `src/proxy.ts`, `src/app/[lang]/layout.tsx`
- Works: `/en` and `/ar` URLs, correct `<html lang dir>`, cookie + Accept-Language negotiation, switcher keeps the current page, typed dictionaries with a parity test, logical CSS for mirroring. Verified by e2e tests and screenshots.
- Missing: Supabase auth emails are English-only (defaults). No per-user language preference stored (no profiles table yet).
- Dependencies: Phase 2 `profiles.locale`; custom email templates.
- Risks: low.
- Next step: bilingual auth email templates when configuring Supabase Auth.

**1.3 Platform branding configuration and theme engine**
- Files: `src/lib/branding/platform.ts`, `src/lib/branding/theme.ts`, `src/app/globals.css`
- Works: the product name, emails and colours come from `NEXT_PUBLIC_PLATFORM_*`. The hex validation blocks CSS injection, and WCAG contrast checks are unit-tested. A guard test blocks hardcoded product names.
- Missing: values are build-time env vars, not editable in a UI or a database (`platform_settings` is planned for Phase 3).
- Dependencies: Phase 3.
- Risks: changing the brand requires a rebuild.
- Next step: Phase 3 `platform_settings` table.

**1.4 Locale routing and session gate (proxy + Data Access Layer)**
- Files: `src/proxy.ts`, `src/lib/supabase/proxy.ts`, `src/lib/auth/session.ts`, `src/lib/supabase/server.ts`
- Works (**verified live against "agent"**): requests to `/app` and `/platform` without a session get **HTTP 307** to `/login?next=…`. The preview flag is correctly ignored once Supabase is configured. The DAL re-checks the session with `getUser()`.
- Missing: signed-in users visiting `/login` are not redirected to the app (minor).
- Dependencies: none.
- Risks: `getUser()` makes a network call to Supabase Auth on every protected request (latency).
- Next step: keep as is. Consider `getClaims()` in the DAL once JWT signing keys are confirmed.

**1.5 Security baseline**
- Files: `src/lib/security/headers.ts`, `next.config.ts`, `src/lib/safe-redirect.ts`, `src/lib/logger.ts`, `src/lib/errors.ts`, `src/lib/auth/schemas.ts`
- Works: CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP and HSTS headers (verified by e2e). Open-redirect guard (unit + e2e). zod validation on every action. Generic auth errors with no account enumeration. Auth email links use the configured site URL, never the Host header. Logs redact secrets. `server-only` boundaries are enforced by a test.
- Missing / weak: CSP allows `'unsafe-inline'` scripts. HSTS includes `preload` before the domain strategy is final. The Permissions-Policy contains the deprecated `interest-cohort`.
- Risks: medium (CSP) and low (others).
- Next step: nonce-based CSP for `/app` and `/platform` (Phase 16). Drop `preload` until production domains are final.

**1.6 Error handling basics**
- Files: `src/app/[lang]/error.tsx`, `src/app/global-error.tsx`, `src/app/[lang]/not-found.tsx`, `src/app/global-not-found.tsx`, `src/app/api/health/route.ts`
- Works: localized error and 404 pages, a reference ID (digest) on server errors, a health endpoint.
- Missing: no error-tracking service (Sentry or similar), no request-ID correlation in logs (the logger supports it, but nothing sets one), and `AppError`/`toPublicError` are not used by any endpoint yet.
- Risks: production errors would be invisible except in host logs.
- Next step: add error tracking and request IDs before pilots (Phase 16/17, can be earlier).

**1.7 Responsive layout**
- Works: e2e on a Pixel 7 viewport covers the mobile menu, the workspace drawer, and no horizontal overflow on 5 key pages.
- Missing: not tested on tablet widths, landscape, or every page.
- Next step: extend the e2e viewport matrix to all routes.

### Category 2: Implemented but not connected to a real backend

**2.1 Workspace shell and navigation** (`src/components/app-shell/*`, `src/app/[lang]/app/[tenant]/*`)
- Works: in UI preview mode only, with fictional tenants. Sidebar, switcher, mobile drawer, theming per tenant.
- Missing: real tenants, membership and access data. A real signed-in user never reaches this shell (see 5.2).
- Next step: Phase 2 tenant context.

**2.2 Tenant context** (`src/lib/tenancy/context.ts`)
- Works: resolves `DEMO_TENANTS` from code **only in preview mode**. Real users get "not found". No code path trusts a slug on its own.
- Missing: any database lookup, membership check, roles or features.
- Risks: none today (no data). This is the most security-critical file to implement next.
- Next step: an RLS-backed membership lookup with isolation tests T1–T15 and T18.

**2.3 Branding editor** (`src/components/branding/branding-editor.tsx`)
- Works: live colour preview, hex validation, contrast warnings.
- Missing: **nothing is saved.** There's no tenant branding table, logo upload or publish flow. The UI states this clearly.
- Next step: Phase 3 `tenant_branding` (draft/published) + storage for logos.

**2.4 Contact / demo request form** (`src/lib/contact/*`, `src/components/forms/contact-form.tsx`)
- Works: validation, required consent, rate limit, and an honest "not stored" message with a pre-filled email link.
- Missing: storage, notification to sales, spam protection (Turnstile).
- Risks: leads are lost if visitors ignore the email link.
- Next step: a `platform_inquiries` table in Phase 2 plus an email notification.

**2.5 Permission catalog and navigation filtering** (`src/lib/permissions/catalog.ts`, `src/lib/navigation/workspace-nav.ts`)
- Works: 35 permission keys, nav filtering by permission and feature (unit-tested).
- Missing: **no enforcement anywhere.** There are no roles in the database and no protected action exists yet. Preview mode shows everything.
- Next step: Phase 2 roles, `role_permissions`, and `app.has_permission()` in RLS.

**2.6 Rate limiting** (`src/lib/rate-limit.ts`)
- Works: sliding-window limits on auth and contact actions, unit-tested.
- Missing: in-memory and per server instance, so it is ineffective on serverless or multi-instance hosting. The IP comes from `X-Forwarded-For`, which clients can spoof unless the host overwrites it.
- Risks: **high before launch** (brute force, abuse of public AI endpoints later).
- Next step: a shared store (Postgres or Redis) and trusted-proxy IP extraction per host.

**2.7 Platform readiness panel** (`src/lib/system/readiness.ts`)
- Works: real checks for the site URL, Supabase config and the secret key presence.
- Missing: the "AI provider" and "Email" rows are hardcoded as "Planned", not real checks.
- Next step: make them real checks when those integrations exist.

### Category 3: UI-only / placeholder

| Item | Files | Notes | Next step |
| --- | --- | --- | --- |
| 17 module placeholders (11 workspace, 6 platform) | `[module]/page.tsx`, `module-placeholder.tsx` | Clearly labelled "Not built yet · Planned · Phase N" | Replaced as each phase lands |
| Chat previews (home, demo, branding) | `chat-preview.tsx` | Static mock with fictional Q&A, labelled "Illustrative" | Replace with a real embedded assistant in Phase 5 |
| White-label demo | `white-label-demo.tsx`, `demo-tenants.ts` | Real theme engine, fictional universities | Keep as a marketing demo |
| Settings → General | `settings/page.tsx` | Read-only fixture values | Phase 3 |
| Overview setup checklist | `[tenant]/page.tsx` | Static steps (not tracked progress) | Compute from real data in Phases 3–5 |
| Privacy Policy / Terms | `privacy`, `terms` pages | Labelled draft templates | Legal review before processing real personal data |

### Category 4: Planned but not implemented

| Feature | Current reality | Dependencies | Risk if rushed | Recommended next step |
| --- | --- | --- | --- | --- |
| Database schema and migrations | 0 tables, no `supabase/migrations` | Project "agent" ✔ | Ad-hoc schema with no isolation | Phase 2 migrations in git, applied to "agent" |
| Tenant isolation / RLS | Design only (`docs/tenant-isolation.md`) | Schema | **Critical:** cross-university data exposure | RLS + composite FKs + isolation tests (gate) |
| Role-based permissions (enforcement) | Catalog only | Schema | Over-privileged staff | Phase 2 roles + RLS helpers |
| Super Admin access | Console visible only in preview, no `platform_admins`, no way to create the first owner | Schema | Lockout or unsafe bootstrap | Phase 2: `platform_admins` + a documented one-time bootstrap |
| Departments and routing | Nav item only | Schema, tickets | — | Phase 2 tables, Phase 7 routing rules |
| AI model integration | No SDK, no key, no code | API key, budgets | Uncontrolled cost, hallucination | Phase 5 after RAG |
| Actual AI vs mock responses | **No AI responses exist.** All chat UIs are static illustrations | — | Demos could be mistaken for working AI | Keep the labels; build the real assistant in Phase 5 |
| Student assistant | Not implemented | Knowledge base, AI | — | Phase 5 |
| Admissions assistant | Not implemented | Programs, leads, anonymous auth | Lead-consent compliance | Phase 6 |
| Academic assistant | Not implemented | Course materials | Mislabelled AI-generated content | Phase 9 |
| Staff assistant | Not implemented | Internal docs, RBAC | Confidential data exposure | Phase 10 |
| Knowledge base upload and processing | Not implemented (no storage buckets, no parsers) | Storage, pgvector, worker | Malicious files, cross-tenant files | Phase 4 |
| RAG retrieval | Not implemented | pgvector (available, not installed), embeddings provider | Cross-tenant retrieval | Phase 4/5 with `match_chunks` under the user's JWT |
| Citations | Not implemented | RAG | Fabricated sources | Phase 5 (provider-native citations mapped to chunks) |
| Tickets and human handoff | Not implemented | Schema, departments | — | Phase 7 |
| Analytics | **No metrics exist.** The overview explicitly shows none (no fake numbers) | Event data | Fabricated dashboards | Phase 8 from stored events only |
| Branding persistence | Not implemented | Schema, storage | — | Phase 3 |
| Audit logs | Not implemented | Schema | Unaccountable admin and support access | Phase 2 |
| Notifications and transactional email | Not implemented. Supabase default SMTP only | Email provider account | Auth emails not delivered to real users | Choose a provider with Supabase Auth config |
| Database backup and recovery | Free plan, no PITR, no backup or restore procedure, no migrations to rebuild from | Paid plan | **Data loss** once real data exists | Upgrade to a paid plan before real data; add PITR for production; write and test a restore runbook |
| CI, monitoring, error tracking | None (checks run manually) | GitHub Actions, Sentry or similar | Regressions reach production | Add CI now (cheap) |

### Category 5: Broken or incomplete

**5.1 Sign-out: BROKEN (verified)**
- Files: `src/components/app-shell/app-shell.tsx` (user menu)
- Evidence: clicking "Sign out" sends no request. Chrome logs *"Form submission canceled because the form is not connected"*. The `<form>` is inside the dropdown content, which unmounts when the menu closes, before the browser submits.
- Impact: once real auth is enabled, users cannot sign out from the workspace (a security and UX problem).
- Why tests missed it: no e2e test covers sign-out.
- Fix: render the form outside the menu (the item submits it via the `form` attribute), or call the action in `onSelect`. Add an e2e test.

**5.2 Post-login dead end for real users: BROKEN for the real flow**
- Files: `src/app/[lang]/app/page.tsx`, `src/lib/tenancy/context.ts`
- A real signed-in user lands on `/app`, which shows an empty state titled "University workspace" with the text "The page you are looking for does not exist…". The page has **no sign-out and no explanation**. `/platform` returns "not found" for every real user.
- Fix: a proper "No university access yet" page with sign-out (now), then real tenants (Phase 2).

**5.3 Sign-in, sign-up and password-reset success paths: INCOMPLETE, never executed**
- Files: `src/lib/auth/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`
- Verified live: wrong password, bad code, bad token, and reset without a session.
- Not verified: sign-up → confirmation email → callback → session, a successful sign-in, password reset by email.
- Required configuration in project "agent" (dashboard): **Site URL and redirect allow-list** (otherwise `emailRedirectTo` falls back to the Site URL, and the PKCE code never reaches `/auth/callback`), **custom SMTP** (the default sender is heavily rate-limited and not meant for real users), **email templates** using `/auth/confirm?token_hash=…` (needed when the link is opened in another browser, which fails PKCE with `pkce_code_verifier_not_found`), and a **self-sign-up policy** (open sign-up vs invitation only).
- Next step: configure Auth, then run a full live e2e with a dedicated test account.

**5.4 Supabase Auth settings: UNVERIFIED** (part of 5.3; the connector cannot read them).

**5.5 Marketing copy overstates availability: INCOMPLETE (commercial and legal risk)**
- Files: `src/content/marketing/en.ts`, `src/content/marketing/ar.ts`
- Examples: "Isolation is tested automatically", "recorded in an append-only audit log", agent descriptions and pricing feature lists are written in the present tense, although none of these exist yet.
- Next step: add "Coming soon" labels or adjust tense before sharing the site with universities.

**5.6 Hardcoded assumptions: INCOMPLETE**

| Location | Hardcoded value | Should come from |
| --- | --- | --- |
| `src/lib/tenancy/context.ts` | `timezone: 'Africa/Khartoum'`, `defaultLocale: 'en'` for every tenant | `tenants.timezone`, `tenants.default_locale` |
| `src/app/[lang]/platform/layout.tsx` | "Back to workspace" link to the `northbridge` demo slug | The user's actual workspaces |
| `src/lib/branding/platform.ts` | `support@example.com`, `sales@example.com` defaults | Production env vars |
| `src/app/global-error.tsx` | Button colour `#1b4f8f` | Theme tokens (minor) |
| `src/lib/branding/demo-tenants.ts` | Two fictional universities | Database seed (demo tenant) in Phase 2 |

**5.7 Duplicate `id="main"` after some client navigations: MINOR**
- Next.js keeps the previous layout mounted but hidden (`<Activity>`). This was observed after switching workspaces, where two `<main id="main">` elements existed. The skip link may then target the hidden one.
- Next step: give the landmark a per-route id, or move focus on navigation.

---

## 5. Security review summary

| Severity | Finding | Status |
| --- | --- | --- |
| **Critical (gate)** | No tenant isolation exists in a database yet | No real data may be onboarded until Phase 2 passes |
| **High** | Sign-out broken (5.1) | Fix first |
| **High** | Rate limiting per instance and IP spoofable via `X-Forwarded-For` | Shared store + trusted proxy before launch |
| **High** | No backups on the Free plan once real data exists | Upgrade before real data |
| Medium | CSP `'unsafe-inline'` scripts | Phase 16 nonce CSP |
| Medium | Supabase Auth redirect, SMTP and template configuration missing | Configure before live auth |
| Medium | Marketing claims vs reality (5.5) | Copy fix |
| Low | `rls_auto_enable()` EXECUTE granted to anon/authenticated | Revoke in the first migration |
| Low | HSTS `preload`, deprecated `interest-cohort` | Header cleanup |
| Low | The whole auth dictionary is serialized to the client (not sensitive) | Optional trim |
| ✔ Verified OK | No secrets in the repo · 0 npm vulnerabilities · no unsafe HTML or `eval` · open-redirect guard · generic auth errors · Host-header-safe email links · preview mode disabled when Supabase is configured (verified live) · `server-only` boundaries | — |

## 6. Environment variables and secrets

- Committed: `.env.example` only (placeholders). `.env*` is git-ignored, and the secret scan of the commit found nothing.
- Project "agent" public values (safe to share): the URL above and a publishable key (`sb_publishable_…`). They are not written to the repository. Set them in `.env.local` or the host's settings.
- The secret (service-role) key is **not** used by any code, and must never be used in request paths.
- Missing for later phases: AI provider key, embeddings provider key, SMTP credentials, error-tracking DSN.

## 7. What the automated tests do and do not prove

- **They prove:** pages render in both languages, routing, validation, redirect safety, theme safety, header presence, accessibility of the tested pages, honest placeholders, and the preview-mode guard.
- **They do not prove:** any successful authentication, sign-out (broken), database behaviour, RLS, tenant isolation, AI behaviour, or file handling. None of these exist or are tested yet.

## 8. Recommended order of work

**Before any new feature (P0):**
1. Fix sign-out (5.1) and add an e2e test.
2. Replace the post-login dead end with an honest "No university access yet" page that includes sign-out (5.2).
3. Configure Supabase Auth for "agent": Site URL, redirect URLs, custom SMTP, bilingual templates, sign-up policy (5.3). Some of this needs your input (email provider, sign-up policy).
4. Label roadmap features on the website as "Coming soon" (5.5).

**Then Phase 2 (the security gate), in project "agent":**

5. Migrations: identity and tenancy tables, RLS on every table, `app.*` helpers, audit log, inquiries, and `revoke execute on rls_auto_enable`.
6. Isolation tests (pgTAP is available in the project; local Postgres harness for CI).
7. RLS-backed tenant context, platform-owner bootstrap, live auth e2e.
8. Shared rate limiting, CI pipeline, error tracking.
9. Before any real university data: upgrade the plan for backups, and document and test a restore.
