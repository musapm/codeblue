# Task Checklist

Legend: `[x]` done and verified · `[~]` partial (see note) · `[ ]` not started

## Phase 0: Discovery, architecture, planning ✅

- [x] Repository and environment inspection (`docs/00-repository-inspection.md`)
- [x] Architecture (`docs/architecture.md`)
- [x] Database architecture (`docs/database-schema.md`)
- [x] Tenant isolation design + test plan (`docs/tenant-isolation.md`)
- [x] Authentication design (`docs/authentication.md`)
- [x] Authorization design + permission catalog (`docs/authorization.md`)
- [x] AI architecture (`docs/ai-architecture.md`)
- [x] Knowledge retrieval architecture (`docs/knowledge-retrieval.md`)
- [x] Deployment strategy (`docs/deployment.md`)
- [x] Security plan (`docs/security.md`)
- [x] Phase roadmap with complexity estimates (`docs/roadmap.md`)
- [x] ARCHITECTURE_DECISIONS.md, PROJECT_STATUS.md, TASKS.md

## Phase 1: Foundation & design system ✅

- [x] Next.js 16.4 + TypeScript (strict) + Tailwind CSS v4 project
- [x] Validated environment config (public/server split, `server-only`)
- [x] Structured logger with redaction; AppError + safe public errors
- [x] Security headers + CSP baseline; open-redirect guard; in-memory rate limiter
- [x] Design tokens + UI components (Button, Input, Field, Card, Badge, Alert, Avatar, menus, sheet, skeletons, empty states)
- [x] Theme engine (validated hex → CSS variables, WCAG contrast checks)
- [x] Central platform branding (product name configurable; guard test)
- [x] i18n: `/[lang]` routing (en/ar), RTL, typed dictionaries with parity test, locale negotiation + switcher
- [x] Public website: Home, Product, Features, Solutions, Pricing, Demo, About, Contact, Privacy, Terms (en + ar)
- [x] White-label demo (two fictional universities, live theme switch)
- [~] Contact form: validation + consent + rate limit; **not stored yet** (honest mailto fallback) → storage in Phase 2
- [x] Auth pages: login, register, forgot password, reset password (+ callback/confirm route handlers)
- [~] Auth wiring to Supabase SSR written but **not exercised against a live project** → Phase 2
- [x] Proxy: locale redirects, session refresh, coarse auth gate
- [x] Workspace shell: sidebar, workspace switcher, user menu, mobile drawer, overview, settings (general + branding preview)
- [x] Platform console shell with environment readiness
- [x] Honest placeholders for all planned modules
- [x] Error boundaries (segment, global), localized 404 + global 404, health endpoint
- [x] Tests: 81 unit/component, 56 e2e (incl. axe), build green

## Phase 2: Auth, tenants & security foundation (NEXT — critical gate)

Blocked on: a dedicated Supabase project for UniAgent (see PROJECT_STATUS "Decisions needed").

- [ ] Create Supabase projects (dev now; staging/prod later); configure Auth URLs + email templates
- [ ] Migrations: tenants, tenant_settings, tenant_branding, tenant_domains, profiles, platform_admins,
      tenant_memberships, permissions, roles, role_permissions, membership_roles, departments,
      membership_departments, invitations, support_access_grants, audit_logs, platform_inquiries
- [ ] `app.*` security helper functions (not exposed via Data API)
- [ ] RLS policies on every table + composite same-tenant FKs
- [ ] Seed: permission catalog, system role templates, demo tenant "Northbridge University"
- [ ] RLS test harness on local PostgreSQL 16 with Supabase auth shim (+ CI against Supabase)
- [ ] Isolation tests T1–T15 (SQL) and T18 (HTTP/Server Actions)
- [ ] Replace `src/lib/tenancy/context.ts` preview-only logic with RLS-backed membership lookup
- [ ] Platform admin check (`platform_admins`) for `/platform`
- [ ] Audit logging RPC + first audited actions (membership/role changes)
- [ ] Persist contact inquiries (consent recorded)
- [ ] Live auth e2e (sign up → confirm → sign in → workspace) against the dev project
- [ ] Move rate limiting to a shared store (Postgres-backed) for auth endpoints
- [ ] Generated DB types committed

## Spike after Phase 2

- [ ] Deployment spike: Vercel vs Cloudflare Workers (OpenNext) with Next 16 Cache Components → ADR-011 final

## Later phases

See `docs/roadmap.md` for Phases 3–17 and their acceptance criteria.

## Known follow-ups (tracked)

- [ ] Nonce-based CSP for `/app` and `/platform` (ADR-013, Phase 16)
- [ ] Legal review of Privacy Policy and Terms (currently labelled drafts)
- [ ] Real support/sales email addresses in production env
- [ ] Dark mode (tokens are ready; not designed yet)
- [ ] CI workflow (GitHub Actions) running `npm run check`, build and e2e
