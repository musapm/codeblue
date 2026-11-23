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
- [x] Migration 9 `knowledge_file_cleanup` (files of deleted documents were left in storage, found live): applied, verified live; test data cleaned up
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

## Phase 5: Student assistant (AI + RAG + citations) 🟡 built and tested; database live; waiting for the API key

- [x] Migration 10 `assistant` (settings, conversations, messages, feedback, usage, budget gate): 9 DB tests; applied to "agent" (byte-identical), RLS/grants/advisors checked live, generated types compared
- [x] Gates in the database: permission `assistant.use`, feature `student_assistant`, on/off switch, monthly budget, question length; conversations private to their author
- [x] Answer pipeline (`src/lib/ai`): retrieval as the student, no model call without passages, Claude Opus 5.5 (effort medium, adaptive thinking, refusal fallbacks), passages as `search_result` blocks, citations mapped to chunks and pages, knowledge gaps, refusals and errors stored with usage and estimated cost (ADR-023, ADR-024)
- [x] Streaming endpoint `/api/assistant/[tenant]` (NDJSON; same-origin, JSON, auth, rate limit); turns complete even if the student leaves
- [x] Student chat `/app/[tenant]/ask`: streaming answers, numbered sources with pages that open the document (signed link with the student's permissions), feedback 👍/👎 with comment, conversation history, disclaimer and handoff to the support email; en/ar, RTL
- [x] Settings `/app/[tenant]/assistant`: on/off, extra guidance (cannot override safety rules), monthly budget, this month's usage and estimated cost
- [x] Tests: unit 143 (26 new: prompt, citations, prices, whole turn with fakes), DB 108, browser 82 (6 new incl. cross-site refusal of the endpoint)
- [~] Eval suite `evals/assistant` (13 cases: English, Arabic, cross-language, mixed, follow-up, unanswerable, injection in document and question, personal data, cross-tenant). **Not run yet: needs `ANTHROPIC_API_KEY` and your approval to spend** (about USD 0.15–0.50 per run, docs/ai-evals.md)
- [ ] Live test of the chat against "agent" (needs the API key)
- [ ] Record turns with a service-role worker instead of the student's session (integrity caveat, ADR-024)
- [ ] Shared (not in-memory) rate limiting for the endpoint (same item as Operations)
- [ ] Ticket drafts from the chat (Phase 7) and admin review of negative feedback / knowledge gaps (Phase 8 "AI quality")

## Phase 6: Admissions agent & leads 🟡 built and tested; database live; visitor flows wait for anonymous sign-ins

- [x] Migration 11 `admissions`: settings, programs, leads (consent record, stages, assignment), notes, history, public page function, visitor inquiries, admissions assistant turns, per-agent budgets, analytics. 28 DB tests; applied to "agent" (byte-identical); advisors checked; types match live columns
- [x] Visitor sessions: anonymous Supabase sign-in from a Server Action; anonymous sessions count as signed out everywhere else; optional Cloudflare Turnstile on visitor sessions and auth forms, CSP only when configured (ADR-025)
- [x] Consent: exact wording + version stored per inquiry; database accepts only the wording currently shown; new wording = new version; staff-recorded inquiries need a consent note (ADR-026)
- [x] Privacy: leads outside the generic audit log; erasure deletes notes and history and leaves a PII-free audit entry; visitors' assistant conversations private; leads only with `leads.read`
- [x] Public pages: programs, program details, inquiry form, admissions assistant (programs + public documents as citable sources, applicant rules), en/ar, university branding
- [x] Staff workspace: inquiries (filters, search), inquiry detail (pipeline, assignment, notes, history, consent record, delete), manual inquiry, programs (create/edit/publish/archive/delete), analytics (stat tiles, weekly columns, stage/source/program bars with table view), settings (page + assistant)
- [x] Tests: unit 156, DB 136, browser 90; visual check of the public page and charts with fictional data
- [ ] **Owner:** enable anonymous sign-ins (+ Turnstile site key and Supabase CAPTCHA together)
- [ ] Live run: visitor inquiry, admissions question (needs the API key), staff pipeline; then remove test data
- [ ] Eval cases for the admissions assistant (programs, fees in Arabic/English, "will I be admitted?" refusal, personal data)
- [ ] Cleanup job for old anonymous users; lead export (access requests) and retention periods
- [ ] Email notification to the admissions office on new inquiries (needs the email provider, Phase 14)

## Later phases

See `docs/roadmap.md` (Phases 7–17): tickets, analytics, academic, staff, workflows, campus, voice, notifications/integrations,
subscriptions, security review, launch.

## Known follow-ups

- [ ] Nonce-based CSP for `/app` and `/platform` (ADR-013)
- [ ] Remove HSTS `preload` until production domains are final; drop the deprecated `interest-cohort`
- [ ] Unique landmark ids across retained routes (duplicate `#main` after workspace switch)
- [ ] `robots.txt` and sitemap
- [ ] Legal review of Privacy Policy and Terms
- [ ] Real support/sales emails in production env
- [ ] Extended e2e viewport matrix
