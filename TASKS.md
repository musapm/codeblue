# Task Checklist

Legend: `[x]` done and verified · `[~]` partial (note says what is missing) · `[ ]` not started

Current state: `PROJECT_STATUS.md` · Audit history: `docs/IMPLEMENTATION_AUDIT.md`

## Phase 0: Discovery, architecture, planning ✅

- [x] Inspection, architecture, database, isolation, authn/authz, AI, RAG, deployment, security docs
- [x] Roadmap, ADR-001…017, implementation audit

## Phase 1: Foundation & design system ✅

- [x] Next.js 16.4 / TypeScript / Tailwind v4, design system, theme engine, platform branding
- [x] en/ar with RTL; public website (10 pages × 2); white-label demo
- [x] Auth pages + Supabase SSR + proxy; workspace and platform shells; error handling
- [x] Audit fixes: sign-out (+ regression test), no-access/unavailable pages, "In development" labels, no hardcoded tenant time zone or locale

## Phase 2: Auth, tenants & security foundation ✅ core complete (gate passed)

- [x] Dedicated Supabase project "agent" (eu-central-1, Free plan)
- [x] Migrations in git (5), applied and verified byte-identical
- [x] Tables: tenants, tenant_settings, tenant_branding, tenant_domains, profiles, platform_admins, tenant_memberships, permissions, features, tenant_features, roles, role_permissions, membership_roles, departments, membership_departments, invitations, support_access_grants, audit_logs
- [x] `app.*` caller-scoped helpers (private schema), RLS on every table, composite same-tenant FKs, least-privilege grants (incl. no TRUNCATE)
- [x] Seeds: 35 permissions, 15 features, 13 system role templates; demo tenant "Northbridge"
- [x] Database-enforced append-only audit log (triggers)
- [x] Support-access grants (≤24 h, read-only, audited). No blanket platform access to tenant content (ADR-014)
- [x] Profile-on-signup trigger (verified on the real `auth.users`)
- [x] API functions: create_tenant, my_workspaces, my_tenant_access, my_platform_role
- [x] Isolation tests T1–T15 (+T11b) on Postgres with Supabase shim (`npm run test:db`, 50 tests)
- [x] T18 live HTTP-level isolation (`e2e/live`, 6 tests passed against "agent")
- [x] App: RLS-backed tenant context, server-side permission gates, platform-owner gate, suspended state, support banner
- [x] Generated DB types; catalog-sync test (TypeScript ↔ SQL)
- [x] Platform-owner bootstrap script (`supabase/seed/bootstrap_platform_owner.sql`)
- [ ] **Owner action:** Supabase Auth Site URL, redirect URLs, SMTP, email templates (`docs/authentication.md`)
- [ ] Live verification of sign-up confirmation and password-reset emails (after the above)
- [ ] Persist contact inquiries (`platform_inquiries`) with consent + spam protection
- [ ] Shared rate limiting (Postgres-backed) with trusted-proxy IP extraction

## Operations (in parallel with Phase 3)

- [ ] CI (GitHub Actions): `npm run check`, `npm run test:db` (Postgres service), build, e2e
- [ ] Error tracking + request IDs in logs
- [ ] **Before real university data:** paid Supabase plan (backups), PITR for production, tested restore runbook
- [ ] Hosting spike: Vercel vs Cloudflare Workers (ADR-011)

## Phase 3: Super Admin & university management (NEXT)

- [ ] Platform console: universities list, create university (`create_tenant`), status changes (suspend/archive), feature toggles
- [ ] Invitations: create (hashed token), email, accept flow (RPC), expiry and revocation
- [ ] Members & roles UI (assign roles and departments; custom roles)
- [ ] Departments UI
- [ ] Audit log viewer (tenant + platform)
- [ ] Branding save/publish (draft → published) + logo upload (storage with tenant-scoped policies)
- [ ] Support-access grant UI (request, approve, revoke, banner)
- [ ] University settings editing (name, locale, time zone, sign-up domains)

## Later phases

See `docs/roadmap.md` (Phases 4–17): knowledge base, student assistant (AI + RAG + citations),
admissions, tickets, analytics, academic, staff, workflows, campus, voice, notifications/integrations,
subscriptions, security review, launch.

## Known follow-ups

- [ ] Nonce-based CSP for `/app` and `/platform` (ADR-013)
- [ ] Remove HSTS `preload` until production domains are final; drop the deprecated `interest-cohort`
- [ ] Unique landmark ids across retained routes (duplicate `#main` after workspace switch)
- [ ] `robots.txt` and sitemap
- [ ] Legal review of Privacy Policy and Terms
- [ ] Real support/sales emails in production env
- [ ] Extended e2e viewport matrix
