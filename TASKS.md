# Task Checklist

Legend: `[x]` done and verified · `[~]` partial (note says what is missing) · `[ ]` not started

Current state: `PROJECT_STATUS.md` · Audit history: `docs/IMPLEMENTATION_AUDIT.md`

## Phase 0: Discovery, architecture, planning ✅

- [x] Inspection, architecture, database, isolation, authn/authz, AI, RAG, deployment, security docs
- [x] Roadmap, ADR-001…022, implementation audit

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

## Operations (in parallel with Phase 4)

- [ ] CI (GitHub Actions): `npm run check`, `npm run test:db` (Postgres service), build, e2e
- [ ] Error tracking + request IDs in logs
- [ ] **Before real university data:** paid Supabase plan (backups), PITR for production, tested restore runbook
- [ ] Hosting spike: Vercel vs Cloudflare Workers (ADR-011)

## Phase 3: Super Admin & university management ✅ core complete (verified live)

- [x] Migration 6 `management` + migration 7 `owner_protection`, applied to "agent", byte-identical to git
- [x] Platform console: universities list (aggregates only), create university (`create_tenant`), status changes (trial/active/suspended/archived), feature toggles
- [~] Invitations: create (256-bit token, SHA-256 hash stored), accept flow (confirmed matching email), expiry, revocation, replacement, preview page. **Missing:** sending the email (link is shown once; needs a transactional email provider)
- [~] Members & roles UI: assign/remove roles and departments, suspend/reactivate, remove, no-escalation invites, ownership reserved to owners. **Missing:** custom roles editor (roles are read-only built-ins)
- [x] Departments UI (create, edit, archive/restore, en/ar names)
- [x] Audit log viewer (tenant + platform, keyset pagination)
- [x] Branding save/publish (draft → published) + logo upload (tenant-scoped storage policies, content sniffing, SVG refused)
- [x] Support-access grant UI (grant ≤ 24 h with reason, revoke, banner, read-only page set ADR-019)
- [~] University settings editing (display names en/ar, locale, time zone, support email). **Missing:** sign-up domains / self-join (no join flow exists yet)
- [x] Tests: 30 new database tests (invitations, escalation, owner guard, profile, branding, platform functions, T16 storage), unit tests, preview e2e + axe, live onboarding suite (`e2e/live/live-management.spec.ts`)
- [ ] Remove replaced logo files from storage (cleanup job)
- [ ] Live re-run of the 2 Phase 2 owner cases with a dedicated demo-tenant owner (blocked from deletion by the owner guard; needs a second owner or a dedicated test tenant)

## Phase 4: Knowledge base & ingestion ✅ core complete (verified live 6/6)

- [x] Migration 8 `knowledge` applied to "agent" (byte-identical)
- [~] Migration 9 `knowledge_file_cleanup` (files of deleted documents were left in storage, found live): tested locally, **awaiting Supabase confirmation**; then remove the 2 leftover test files
- [x] Tables: knowledge_documents (metadata, visibility, authority, dates, source URL), knowledge_document_versions (upload state machine, hash, page/char/chunk counts, safe error codes), knowledge_chunks (Arabic + English full-text, optional pgvector embedding + model), knowledge_document_access (restricted lists)
- [x] Visibility: public / members / staff / restricted (departments, roles); drafts hidden until published (knowledge.publish); archived and expired documents excluded; support sessions excluded
- [x] Atomic version activation (retrieval never mixes versions); deletion removes versions + chunks in one transaction, then files
- [x] search_knowledge: permission filter before ranking, full-text (Arabic stemmer + normalization, English stemmer), optional vector similarity with RRF fusion, authority/priority boost
- [x] Private bucket `tenant-documents`: uploads only to registered paths; originals readable by document readers (signed URLs)
- [x] T16 (original files) and T17 (retrieval isolation) database tests
- [x] Ingestion: content-signature checks, PDF (unpdf) with Arabic reading-order reconstruction, DOCX (mammoth), TXT, CSV, NFKC + Arabic mark repair, structure-aware chunking with page ranges and overlap, scanned-PDF detection (needs_ocr)
- [x] Upload flow: signed direct-to-storage upload, server verification (size, signature, SHA-256), processing after the response (`after()`), retry
- [x] UI: list with live status, upload with full metadata, document page (passage preview, versions, downloads, publish/archive/delete, new version), test search; en/ar
- [x] Tests: unit 117 (incl. real-file extraction with generated fixtures), preview e2e 76, live spec written (`e2e/live/live-knowledge.spec.ts`)
- [x] Live knowledge suite against "agent": 6/6 (English/Arabic PDF, DOCX, scanned PDF, disguised file, EN/AR search, T17 live, versioning, deletion)
- [~] Embeddings: provider interface + storage + vector search path implemented and tested with synthetic vectors. **Needs a provider and key** (Voyage AI / OpenAI / Cohere) and the Arabic/English benchmark (ADR-021)
- [ ] OCR for scanned PDFs (later)
- [ ] Background worker with retries for large files (currently processed after the upload response, with the uploader's session; ADR-022)
- [ ] Virus-scan hook

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
