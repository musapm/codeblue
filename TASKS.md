# Task Checklist

Legend: `[x]` done and verified · `[~]` partial (note says what is missing) · `[!]` broken (found in audit) · `[ ]` not started

Source of truth for the current state: `docs/IMPLEMENTATION_AUDIT.md` (2026-11-21).

## Phase 0: Discovery, architecture, planning ✅

- [x] Repository and environment inspection
- [x] Architecture, database, tenant-isolation, authn/authz, AI, RAG, deployment, security docs
- [x] Roadmap, ADR-001…013, PROJECT_STATUS.md, TASKS.md
- [x] Implementation audit (`docs/IMPLEMENTATION_AUDIT.md`)

## Phase 1: Foundation & design system (complete except two audit defects)

- [x] Next.js 16.4 + TypeScript strict + Tailwind v4 project, scripts, lint, tests
- [x] Validated env config, logger with redaction, AppError, security headers, redirect guard
- [x] Design system components and theme engine (validated hex → CSS variables, contrast checks)
- [x] Central platform branding (env-based) with a guard test against hardcoded names
- [x] i18n en/ar with RTL, negotiation, switcher, parity test
- [x] Public website: 10 pages × 2 languages, white-label demo
- [x] Locale routing + session refresh + auth gate in the proxy (307 verified live against "agent")
- [x] Error boundaries, 404s, health endpoint
- [~] Auth pages and actions connected to Supabase: failure paths verified live; **success paths never executed**; Auth settings not configured
- [!] **Sign-out from the user menu does nothing** (form detached when the dropdown closes)
- [!] **Post-login dead end** for real users (misleading message, no sign-out on `/app`)
- [~] Workspace shell, branding editor, platform console: UI only on preview fixtures; nothing persists
- [~] Contact form: validates, but nothing stored or sent
- [~] Rate limiting: in-memory per instance, spoofable IP source

## P0: Fix before any new feature

- [ ] Fix sign-out (submit outside the dropdown or via `onSelect`) + e2e test
- [ ] "No university access yet" page with sign-out for signed-in users without memberships
- [ ] Label roadmap features as "Coming soon" on the website (en + ar) and adjust present-tense claims
- [ ] Remove hardcoded tenant timezone and locale assumptions (move to the tenant record in Phase 2) and the platform "back" link to the demo slug
- [ ] Configure Supabase Auth for "agent": Site URL, redirect URLs (`/auth/callback`, `/auth/confirm`), custom SMTP (provider decision needed), bilingual email templates using `token_hash`, sign-up policy
- [ ] Live auth e2e with a dedicated test account (sign up → confirm → sign in → sign out → reset)

## Phase 2: Auth, tenants & security foundation (critical gate). Project: `agent` (`zijruhuvzxtuudsvnwgy`)

- [x] Dedicated Supabase project identified and inspected (empty, eu-central-1, Free plan)
- [ ] `supabase/migrations/` in git as the single source of truth
- [ ] Migration 1: extensions (`citext`; `vector` later), `app` schema helpers, `revoke execute on public.rls_auto_enable() from anon, authenticated`
- [ ] Tables: tenants, tenant_settings, tenant_branding, tenant_domains, profiles, platform_admins, tenant_memberships, permissions, roles, role_permissions, membership_roles, departments, membership_departments, invitations, support_access_grants, audit_logs, platform_inquiries
- [ ] RLS on every table + composite same-tenant FKs + indexes
- [ ] Seed: permission catalog, system role templates, demo tenant "Northbridge University" (replaces `demo-tenants.ts` in the product)
- [ ] Isolation tests T1–T15 (pgTAP in the project + local Postgres harness for CI) and T18 (HTTP/Server Actions)
- [ ] RLS-backed tenant context in `src/lib/tenancy/context.ts`; `AccessSnapshot` from real roles and features
- [ ] `platform_admins` gate for `/platform` + documented one-time owner bootstrap
- [ ] Audit-log RPC; audit membership and role changes
- [ ] Persist contact inquiries (consent recorded) + sales notification
- [ ] Shared rate limiting (Postgres-backed) with trusted-proxy IP extraction
- [ ] Generated DB types committed
- [ ] Re-run security advisors after migrations (must be clean)

## Operations (start alongside Phase 2)

- [ ] CI (GitHub Actions): `npm run check`, build, e2e
- [ ] Error tracking (e.g. Sentry) + request IDs in logs
- [ ] **Before real university data:** upgrade the Supabase plan (backups), PITR for production, tested restore runbook
- [ ] Hosting spike: Vercel vs Cloudflare Workers (ADR-011)

## Later phases

See `docs/roadmap.md` (Phases 3–17). Nothing in Phases 3–17 has been started: there is no AI,
knowledge base, RAG, citations, tickets, departments routing, analytics, branding persistence,
subscriptions, notifications, voice or integrations.

## Known follow-ups

- [ ] Nonce-based CSP for `/app` and `/platform` (ADR-013)
- [ ] Remove HSTS `preload` until production domains are final; drop the deprecated `interest-cohort`
- [ ] Unique landmark ids across retained routes (duplicate `#main` after workspace switch)
- [ ] `robots.txt` and sitemap
- [ ] Legal review of Privacy Policy and Terms
- [ ] Real support/sales emails in production env
- [ ] Extend e2e viewport matrix (tablet, landscape, all routes)
- [ ] Dark mode (tokens ready, not designed)
