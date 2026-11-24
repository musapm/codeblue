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
- [x] Ticket drafts from the chat (Phase 7: "Ask a person" link and AI draft)
- [x] Admin review of negative feedback / knowledge gaps (Phase 8 "AI quality")

## Phase 6: Admissions agent & leads 🟡 built and tested; database live; visitor flows wait for anonymous sign-ins

- [x] Migration 11 `admissions`: settings, programs, leads (consent record, stages, assignment), notes, history, public page function, visitor inquiries, admissions assistant turns, per-agent budgets, analytics. 28 DB tests; applied to "agent" (byte-identical); advisors checked; types match live columns
- [x] Visitor sessions: anonymous Supabase sign-in from a Server Action; anonymous sessions count as signed out everywhere else; optional Cloudflare Turnstile on visitor sessions and auth forms, CSP only when configured (ADR-025)
- [x] Consent: exact wording + version stored per inquiry; database accepts only the wording currently shown; new wording = new version; staff-recorded inquiries need a consent note (ADR-026)
- [x] Privacy: leads outside the generic audit log; erasure deletes notes and history and leaves a PII-free audit entry; visitors' assistant conversations private; leads only with `leads.read`
- [x] Public pages: programs, program details, inquiry form, admissions assistant (programs + public documents as citable sources, applicant rules), en/ar, university branding
- [x] Staff workspace: inquiries (filters, search), inquiry detail (pipeline, assignment, notes, history, consent record, delete), manual inquiry, programs (create/edit/publish/archive/delete), analytics (stat tiles, weekly columns, stage/source/program bars with table view), settings (page + assistant)
- [x] Tests: unit 156, DB 136, browser 90; visual check of the public page and charts with fictional data
- [ ] **Owner:** enable anonymous sign-ins (+ Turnstile site key and Supabase CAPTCHA together)
- [~] Live run: spec written (`e2e/live/live-admissions.spec.ts`), **not run**. Needs anonymous sign-ins; the admissions question also needs the API key
- [x] Eval cases for the admissions assistant (`evals/admissions`, 10 cases). Built; needs the key to run
- [~] Migration 12 (`admissions_maintenance`): audited lead export (button on the inquiry page) and the anonymous-visitor cleanup. 6 DB tests. **Not applied yet**; then schedule the cleanup with pg_cron (`supabase/README.md`)
- [ ] Retention periods for inquiries (policy decision)
- [ ] Email notification to the admissions office on new inquiries (needs the email provider, Phase 14)

## Phase 7: Tickets & human handoff 🟡 built and tested locally; migration 13 not applied

- [x] Migration 13 `tickets`: categories with routing, tickets, public thread, internal notes in their own table, history, in-app notifications, AI gate and usage (ADR-027). 26 DB tests, local only
- [x] Privacy in the database: requesters never read internal notes or history (even if they are staff); department staff see only their queues; general queue for `tickets.read_all`; transfers and assigning others need `tickets.assign`
- [x] Found and fixed by the tests: NULL comparisons in the permission checks let staff without the permission add notes in other departments or unassign colleagues (helpers now never return NULL; regression test added)
- [x] My requests (`/app/[tenant]/requests`): list, new request, thread, reply, close
- [x] Staff (`/app/[tenant]/tickets`): queues (assigned to me, my departments, unassigned, all) with open/done and search; ticket page with the thread, reply, status/priority/category/department/assignee, internal notes, the shared conversation and history; categories & routing page
- [x] Handoff from the student chat: "Ask a person" after an answer opens a new request linked to the conversation; sharing the conversation is opt-in and shares only messages up to the request
- [x] AI: draft a request from the student's own conversation (editable, never sent by the AI); staff summary stored as a labelled internal note; low effort, structured output, budget and 30 calls per person per day
- [x] Notifications: header bell with the unread count, notifications page, mark all read (in-app only)
- [x] Tests: unit 168, DB 168, browser 100 (8 new); visual check of the thread and forms (en/ar)
- [ ] **Apply migration 13** to "agent" (with your Supabase session), then a live run: a student request, staff reply, note, transfer, notifications, AI draft/summary (needs the API key)
- [ ] Attachments on tickets (storage bucket + scanning)
- [ ] SLAs and reminders; assignment rules beyond categories (round robin, workload)
- [ ] Email notifications (needs the email provider, Phase 14)
- [ ] Eval cases for the ticket draft and summary
- [ ] Retention periods for closed tickets (policy decision)

## Phase 8: Admin dashboard & analytics 🟡 built and tested locally; migration 14 not applied

- [x] Migration 14 `analytics`: `analytics_overview` (assistants, tickets, admissions, knowledge, AI cost, quality counts) computed from stored rows in the university's own days; knowledge gaps grouped by question; flagged answers; reviews (ADR-028). 25 DB tests, local only
- [x] Privacy in the database: aggregate numbers only for `analytics.view`; costs for `analytics.ai_costs.view`; gap questions for `quality.review`/`knowledge.manage`; flagged answers for `quality.review`; never who asked; contact details, links and long numbers redacted; answers withheld when the reviewer cannot read the documents behind them
- [x] Analytics page (`/app/[tenant]/analytics`): periods 7/30 (90 with advanced analytics), headline figures, each assistant (questions per day, outcomes, ratings, answer time), knowledge gaps, requests & tickets (volume, backlog, first reply, resolution, queues, categories), knowledge base (published, expired, most cited), admissions inquiries, AI cost vs budgets, AI quality
- [x] AI quality page (`/app/[tenant]/quality`): unanswered (grouped), rated not helpful, declined; open/reviewed, period and assistant filters; review with outcome and note, change, reopen
- [x] Overview: the last 7 days for people who can view analytics (real data only)
- [x] People are told in both assistants that unanswered and rated questions may be reviewed without their identity
- [x] Shared chart components (column chart with table view and keyboard tooltips, ranked bars, stat tiles, budget meters); two accessibility issues in the old charts fixed
- [x] Tests: unit 176, DB 193, browser 109 (9 new); visual check with fictional data (en/ar)
- [ ] **Apply migration 14** to "agent" (with migrations 12 and 13), then a live look at real figures
- [ ] Rollup tables if a university's volume makes the dashboard slow
- [ ] AI clustering of similar gap questions (needs the API key)
- [ ] Export (CSV) and scheduled email digests of the figures (needs the email provider)
- [ ] Platform-wide usage across universities (Phase 15)

## Phase 9: Academic assistant 🟡 built and tested locally; migration 15 not applied

- [x] Migration 15 `academic`: Faculty member role; courses (per-course enablement, join codes), enrollment, course materials in the knowledge pipeline, academic settings (budget, daily limit), private study aids with server-side quiz grading, progress, class figures (ADR-029). 28 DB tests, local only
- [x] Course materials readable only inside the course; never in the knowledge base or the general assistant; Phase 4 rules unchanged (all knowledge tests still pass)
- [x] AI study aids (summaries, practice quizzes, flashcards, study plans) with structured output, cached materials, checked references, labelled as AI-generated with their sources
- [x] Pages: My courses (join with a code), course page (materials, study tools, my study aids), study aid page (quiz, flashcards, study plan), course management (details, tools, materials upload/publish/delete, enrollment and roster, instructors, class figures), academic admin (courses, budget, activity)
- [x] Analytics: academic card, cost and budget; course materials excluded from the knowledge figures
- [x] Tests: unit 191, DB 221, browser 115 (6 new); visual check of the study components (en/ar)
- [ ] **Apply migration 15** (with 12–14), then a live run: create a course, upload and publish a material, join as a student, make each study aid (needs the API key), take a quiz, check the class figures
- [ ] Eval set for the study tools (accuracy against the materials, Arabic and English)
- [ ] Instructor-reviewed quizzes shared with the class
- [ ] Students' own uploads (storage, scanning, quotas)
- [ ] Enrollment from the student information system (Phase 14)

## Phase 10: Staff assistant 🟡 built and tested locally; migration 16 not applied

- [x] Migration 16 `staff`: staff assistant settings (switch, guidance, budget, daily limit), `staff` conversations, private drafts, the staff gate, drafting and ticket-digest functions, `search_knowledge` with a department filter, staff usage in analytics (ADR-030). 16 DB tests, local only
- [x] Department-scoped internal search: the staff chat with an optional department filter that only narrows what the person may read; staff conversations kept apart from student ones
- [x] Drafting tools: emails, letters and announcements grounded in readable documents, with [placeholders] for missing details, their sources, copy buttons and deletion; private to the author; never sent by the AI
- [x] Ticket summaries: an AI digest of the open tickets the person works (mine, my departments, all), with contact details redacted before sending, references checked and linked; not stored
- [x] Settings page (switch, guidance, budget, daily limit, this month's use); analytics staff card, cost and budget
- [x] Permission tests: DB (gate, settings, conversations, department-scoped search, drafts, digest scope, usage, audit), unit 212 (21 new), browser 124 (9 new); visual check of a draft and the digest (en/ar)
- [ ] **Apply migration 16** (with 12–15), turn on the `staff_assistant` feature and the switch, then a live run: a question with and without a department filter, a draft in each language, a digest per view (needs the API key)
- [ ] Eval set for the staff tools (grounding of drafts, digest faithfulness, Arabic and English)
- [ ] Send a draft from the app (needs email integration, Phase 14); shared templates
- [ ] Semantic search (embeddings, ADR-021) for better internal retrieval

## Phase 11: Workflow agents 🟡 built and tested locally; migration 17 not applied

- [x] Migration 17 `workflows`: versioned request forms (drafts, published versions that never change), requests with tracking numbers and answers checked against their version, the status flow, comments and internal notes, assignment, request notifications, form-suggestion settings and gate, analytics counts (ADR-031). 20 DB tests, local only
- [x] Confirmation step: review exactly what will be sent and the form's confirmation text before submitting; a changed form must be reviewed again
- [x] Requester pages: available forms, the AI form suggestion (pre-fills only), the form, request tracking with updates, messages and cancellation
- [x] Staff pages: queue (mine, my departments, unassigned, all), request page (next step with a message, assignment, internal notes), form builder (fields in English and Arabic, choices, order) with drafts, publishing and versions, suggestion settings
- [x] Notifications for requests in the existing bell and page; service requests in analytics
- [x] Tests: unit 226 (14 new), DB 257 (20 new), browser 133 (9 new); visual check (en/ar)
- [ ] **Apply migration 17** (with 12–16), turn on `workflow_agent`, publish the first forms, then a live run of a request end to end (and a form suggestion, with the API key)
- [ ] Attachments on requests (storage, scanning, quotas)
- [ ] Multi-step approval chains and deadlines with reminders
- [ ] Email notifications (Phase 14)
- [ ] Eval set for the form suggestion; starting a request from the student chat

## Phase 12: Campus map & assistant 🟡 built and tested locally; migration 18 not applied

- [x] Migration 18 `campus`: locations (buildings and what is inside them, coordinates, weekly hours, accessibility facts, contact, other names), search in both languages, campus answers settings and gate, the answers' cost in analytics (ADR-032). 9 DB tests, local only
- [x] Locations admin: create, edit, publish, delete (drafts hidden from members)
- [x] Search, a simple map from coordinates (no map tiles; keyboard accessible), location pages with hours and open now in the university's time zone, accessibility (yes / no / not recorded) and contact
- [x] AI campus answers from the matching location records only ("open now" computed by the app), off by default
- [x] Tests: unit 235 (9 new), DB 266 (9 new), browser 140 (7 new); visual check (en/ar)
- [ ] **Apply migration 18** (with 12–17), turn on `campus_assistant`, publish the first locations, then a live run (search, a campus question with the API key)
- [ ] A drawn campus plan or real map tiles (needs a provider and a privacy decision); routes and indoor directions
- [ ] Holiday calendars and exceptions; public access to the directory for visitors
- [ ] Campus answers inside the student chat; eval set for campus answers

## Phase 13: Voice 🟡 built and tested locally; migration 19 not applied

- [x] Migration 19 `voice`: settings (off by default; input and read-aloud; browser or server provider; the university's prices, budget, daily input limit), separate usage table without audio or text, the server gate, usage figures, voice use in analytics (ADR-033). 8 DB tests, local only
- [x] Provider interface: browser speech (working) and a server `SpeechProvider` with endpoints, budget and limits (no vendor connected)
- [x] Microphone and read-aloud in the student and staff chats; privacy notice; Voice settings page with contract prices, usage and the provider evaluation
- [x] Provider and cost evaluation: `docs/voice.md`
- [x] Tests: unit 249 (14 new), DB 274 (8 new), browser 144 (4 new); visual check (en/ar)
- [ ] **Apply migration 19** (with 12–18), turn on `voice`, then test dictation and read-aloud on real devices (Arabic and English)
- [ ] **Decision:** a server speech vendor (only if browser speech is not good enough); then write and test its adapter
- [ ] Voice in the public admissions assistant; an Arabic dialect setting per university; streaming speech input

## Phase 14: Notifications & integrations 🟡 built and tested locally; migration 20 not applied

- [x] Migration 20 `notifications_integrations`: preferences, the email outbox (references only), notify functions following preferences, integrations with status, log and secret names (ADR-034). 6 DB tests, local only
- [x] Notification settings page; integrations list, create, edit, status, delete, log; outbox counts
- [x] Email sender interface and delivery round (tested with fakes)
- [x] Tests: unit 255 (6 new), DB 280 (6 new), browser 149 (5 new)
- [ ] **Apply migration 20** (with 12–19), turn on `integrations`, then check preferences live
- [ ] **Decision:** an email provider and its key; then the adapter and a scheduled worker (service role) that sends the queue; invitation emails can use it too
- [ ] Connectors (LMS, SIS, SSO, messaging, webhooks) once a university provides credentials; reading secrets from Supabase Vault or the hosting's environment
- [ ] Digest emails; SMS and push

## Later phases

See `docs/roadmap.md` (Phases 15–17): subscriptions, security review, launch.

## Known follow-ups

- [ ] Nonce-based CSP for `/app` and `/platform` (ADR-013)
- [ ] Remove HSTS `preload` until production domains are final; drop the deprecated `interest-cohort`
- [ ] Unique landmark ids across retained routes (duplicate `#main` after workspace switch)
- [x] `robots.txt` and sitemap (marketing pages; workspaces, console, auth and APIs excluded)
- [ ] Legal review of Privacy Policy and Terms
- [ ] Real support/sales emails in production env
- [ ] Extended e2e viewport matrix
