# Development Progress Log

Chronological log of significant work. For the current snapshot see `PROJECT_STATUS.md`.

## 2026-11-21: Phases 0 and 1

- Inspected the repository: empty apart from a one-line README. Found Next.js 16.4 defaults (Cache
  Components, proxy) and an existing Supabase account with projects for other products (left untouched).
- Wrote the planning documentation: architecture, database, tenant isolation, authentication,
  authorization, AI, knowledge retrieval, deployment, security, roadmap, and ADR-001…013.
- Built the Phase 1 foundation: Next.js 16 + TypeScript + Tailwind v4 design system, theme engine,
  en/ar i18n with RTL, a public website (10 pages × 2 languages), auth pages wired to Supabase SSR
  (disabled with a clear notice until configured), the proxy, workspace and platform console shells with
  honest module placeholders, a branding preview editor, security headers, a logger, rate limiting, and
  error boundaries.
- Verification: typecheck ✔, lint ✔, 81 unit/component tests ✔, 56 Playwright e2e tests ✔ (including axe
  accessibility checks), production build ✔.
- Fixed during QA: unlabeled branding inputs and low-contrast phase markers (both found by axe), the
  preview banner clipping the sidebar, and Arabic avatar initials forming an unintended word.

## 2026-11-21: Implementation audit

- Audited the code, routes, integrations and the new dedicated Supabase project **"agent"**
  (`zijruhuvzxtuudsvnwgy`, eu-central-1, Free plan). It is empty: no app tables, migrations or users.
  The CodeBlue and Terma projects were not accessed or modified.
- Confirmed: 0 database queries in code, no AI integration, no migrations. Auth is the only backend integration.
- Ran non-mutating live checks against "agent": proxy 307 ✔, wrong-password sign-in ✔ (en/ar),
  bad code/OTP ✔, reset without session ✔.
- Found defects: **sign-out broken** (form detached when the dropdown closes), **post-login dead end**
  for real users, Auth settings unconfigured, marketing copy overstates availability, hardcoded tenant
  timezone and locale. No fixes were applied during the audit (by request).
- Report: `docs/IMPLEMENTATION_AUDIT.md`. PROJECT_STATUS.md and TASKS.md were rewritten to match it.

## 2026-11-22: P0 fixes and Phase 2 (database, tenant isolation)

- **P0 fixes:** sign-out repaired (+ regression test); honest "No university access yet" and "workspace
  unavailable" pages with sign-out; website labels unbuilt capabilities "In development" with a pilot
  notice; hardcoded tenant time zone and locale removed.
- **Phase 2 in Supabase project "agent":** 5 migrations covering identity, tenancy, roles, departments,
  invitations, support grants, features, the audit log, RLS on every table, composite same-tenant FKs,
  caller-scoped API functions, and the profile-on-signup trigger. Applied and verified byte-identical
  to git. Demo university "Northbridge" seeded. Types generated.
- The isolation suite **caught a real flaw** in the first policy draft: platform staff could read all
  university content without a grant. It was fixed before anything reached the live project (ADR-014).
- App connected to real data: tenant context from the database, permission gates on settings, branding
  and modules, support-access banner, platform-owner gate.
- **Tests:** 88 unit, 50 database isolation, 58 browser (preview), and **6 live tests against "agent"**
  using temporary accounts that were deleted afterwards.

## 2026-11-22: Phase 3 (university management)

- **Database:** migration 6 (`management`) and migration 7 (`owner_protection`) are applied to "agent" and byte-identical to git.
  - Invitations: hashed single-use tokens, confirmed-email acceptance, no escalation.
  - Member listing, profile and branding publishing, platform overviews.
  - Last-owner guard and owner-only ownership changes. The second guard was found during design: administrators held `roles.manage` and could otherwise promote themselves.
  - Logo bucket with per-tenant policies.
- **App:**
  - platform console: universities, create, status, features, owner invitations, support access, audit;
  - workspace: members & roles, departments, audit, editable settings, branding publish + logo;
  - invitation page; registration and sign-out keep a safe return path.
- **Tests:** 97 unit, 80 database, 72 browser (preview + axe). The live onboarding suite ran 9/9 against "agent".
- **The live run found a real gap:** support sessions could see only the overview. Fixed with a fixed read-only page set (ADR-019).
- **Deferred:** invitation email (provider decision), custom roles editor, sign-up domains.

## 2026-11-23: Phase 4 (knowledge base), built and tested locally

- Migration 8 `knowledge` covers documents, versions, chunks, access lists, visibility rules, the write API, `search_knowledge` and the private bucket. It is tested locally (98 DB tests including T16/T17) but not yet applied to "agent", because the Supabase confirmation prompt has not been answered.
- Ingestion covers PDF, DOCX, TXT and CSV. Real-file tests found that **Arabic PDFs extract in reversed visual order**, so `pdf-bidi.ts` now rebuilds reading order from glyph positions. They also found two normalization bugs, both fixed: misaligned Arabic letter mapping, and harakat detached by NFKC.
- UI: knowledge list with live status, signed direct upload with metadata, document page with passage preview, versions, publish/archive/delete, and test search.
- Embeddings are prepared but inactive: they need a provider key and a benchmark (ADR-021).

## 2026-11-23: Phase 4 verified live

- Migrations 8 and 9 are applied to "agent" and byte-identical. The live knowledge suite passed 6/6 (English/Arabic PDF, DOCX, scanned PDF, disguised file, EN/AR search, T17 live, versioning, deletion).
- The live run found one real defect: files of deleted documents stayed in storage. Fixed by migration 9 and verified.
- All temporary test data was removed (0 users; only the demo university remains).

## 2026-11-23: Phase 5 (student assistant), built and tested locally

- **Database:** migration 10 `assistant` (settings, private conversations and messages, feedback, `ai_usage_events`, budget gate, six `assistant_*` functions). 9 DB tests pass locally (108 total). Applied to "agent" (version `20261123124604`), byte-identical; RLS, grants, advisors and generated types checked.
- **AI pipeline:** retrieval with the student's own permissions; no model call when nothing readable matches; Claude Opus 5.5 with passages as `search_result` blocks, so every cited sentence maps back to a stored passage and page; refusals, knowledge gaps and errors are stored with tokens and estimated cost. Monthly budget per university is enforced in the database.
- **App:** streaming chat for students (sources open the cited document; feedback; history; Arabic/English) and a settings page for administrators (switch, guidance, budget, usage).
- **Tests:** 143 unit (incl. the whole turn with a fake database and fake SDK), 108 DB, 82 browser. The live AI eval (13 cases) is built but **not run**: there is no API key in this environment yet.
- **Found while building:** the prompt is below the model's 512-token caching minimum, so it is not cached yet (documented in ADR-023 instead of claiming savings). The settings page showed a misleading "$0.00" budget in preview mode, and the "New conversation" button overflowed its card; both were fixed.

## 2026-11-23: Phase 6 (admissions & leads)

- **Database:** migration 11 `admissions`: programs, consented leads with stages, assignment, notes and history, a public page function, visitor inquiries and admissions assistant turns with per-visitor limits, per-agent AI budgets, analytics. 28 DB tests (136 total). Applied to "agent" (byte-identical).
- **Design decisions:**
  - Visitors get anonymous Supabase sessions, with Turnstile enforced by Supabase Auth (ADR-025).
  - Leads keep their exact consent wording and stay out of the append-only audit log, so they can be erased (ADR-026).
- **App:**
  - public admissions page (programs, program details, assistant, inquiry form) in English and Arabic with the university's branding;
  - staff workspace (inquiries, inquiry detail, programs, analytics, settings).
  The student and admissions assistants share one tested answer pipeline.
- **Found while building:**
  - The audit trigger would have copied lead PII into the append-only log, so leads use their own history instead.
  - The database accepted any consent text from the caller, so it now accepts only the wording the university shows.
  - Whole tuition amounts showed `.00`.
  - The settings page blamed permissions in preview mode.
- **Not live yet:** anonymous sign-ins are disabled on the project, so no visitor flow has run against "agent".

## 2026-11-23: Phase 6 follow-ups (nothing applied to Supabase)

- **Migration 12** (local, 6 DB tests):
  - an audited export of one inquiry for access requests (JSON download on the inquiry page);
  - the cleanup of old anonymous visitor accounts, to be scheduled with pg_cron.
  It waits for the owner's Supabase session.
- **Admissions eval:** 10 cases; needs the API key.
- **Live admissions spec:** written, not run.
- **Other:** `robots.txt` and `sitemap.xml`; the Inquiries tab stays active on inquiry pages.

## 2026-11-23: Phase 7 (tickets & human handoff), nothing applied to Supabase

- **Database:** migration 13 `tickets` (local, 26 DB tests, 168 total): categories with routing, tickets, a public thread, internal notes in their own table, history, in-app notifications, and the AI gate and usage.
- **Design decision:** one queue model; notes the requester can never read; AI only as an editable draft or a labelled internal note; conversations shared only when the student ticks the box, and only up to the request (ADR-027).
- **App:**
  - "My requests" for students and staff;
  - staff queues, the ticket page and categories & routing;
  - "Ask a person" in the student chat;
  - the header bell and the notifications page.
  All in English and Arabic.
- **Found while building:** permission helpers could return NULL, and `if not NULL` lets the action through in PL/pgSQL. Staff without the permission could add notes in other departments or unassign colleagues. Fixed, with a regression test.
- **Not live yet:** migration 13 waits for the owner's Supabase session; the AI features need the API key.

## 2026-11-23: Phase 8 (admin dashboard & analytics), nothing applied to Supabase

- **Database:** migration 14 `analytics` (local, 25 DB tests, 193 total). It holds the dashboard function, the knowledge-gap and flagged-answer queues, reviews, and the redaction and visibility helpers. There are no rollup tables: every number is computed from stored rows when requested.
- **Design decision (ADR-028):** reviewers see one exchange at a time, never who asked, with contact details redacted. They do not see an answer built from documents they cannot read. Both assistants now say that this review may happen.
- **App:**
  - the analytics page and the AI quality page;
  - the last 7 days on the overview;
  - shared chart components following the dataviz rules (single hue, table views, keyboard tooltips, meters for budgets).
- **Found while building:**
  - a formatting function was passed to a client component, which only fails once there is data. The preview tests could not see it; the visual check with fictional data did;
  - money showed `$6.8`;
  - the old charts had two accessibility issues (unnamed focusable columns; `aria-label` on plain text). All fixed.
- **Not live yet:** migration 14 waits for the owner's Supabase session, together with 12 and 13.

## 2026-11-23: Phase 9 (academic assistant), nothing applied to Supabase

- **Database:** migration 15 `academic` (local, 28 DB tests, 221 total). It adds:
  - the Faculty member role;
  - courses with per-course study tools and join codes, and enrollment;
  - course materials through the existing knowledge pipeline;
  - private study aids with quiz answers kept in the database;
  - class figures that show accuracy only from 5 students.
- **Design decision (ADR-029):**
  - one ingestion pipeline for the knowledge base and courses, with course materials readable only inside their course;
  - study aids private to their owner and always labelled as AI-generated, with their sources.
- **App:**
  - My courses, the course page and study aids (quiz, flashcards, study plan);
  - course management and the academic admin;
  - the analytics academic card.
  Generation uses one structured-output call with the materials cached.
- **Checked:** all Phase 4 knowledge tests still pass after the read and manage helpers gained a course branch. Two lint findings (reading the clock during render) were fixed by computing the dates outside the components.
- **Not live yet:** migration 15 waits for the owner's Supabase session; generation needs the API key.

## 2026-11-24: Phase 10 (staff assistant), nothing applied to Supabase

- **Database:** migration 16 `staff` (local, 16 DB tests, 237 total). It adds:
  - staff assistant settings (off by default, guidance, monthly budget, daily limit per person);
  - `staff` conversations and private drafts;
  - a ticket-digest source that returns only tickets the caller works, without requester identity or notes;
  - a department filter on `search_knowledge` that only narrows what the person may read.
- **Design decision (ADR-030):** the grounded pipeline for staff; the AI never sends anything; ticket text is redacted before it goes to the model; staff conversations stay out of the AI quality review.
- **App:**
  - the staff chat with a department filter and its own endpoint;
  - drafts (form, list, draft page with copy buttons, missing details and sources);
  - the ticket digest;
  - the settings page;
  - the staff card and budget in analytics.
- **Found while building:**
  - a CHECK constraint that evaluates to NULL passes, so a draft without a body was accepted (fixed with `coalesce`, DB test);
  - the digest's coverage line said "Based on 75 open tickets" when it covered 60 of them (fixed; found by the visual check, now a component test);
  - AI errors in two older actions showed "The database is not configured" when the AI key was missing (now "AI is not configured").
- **Not live yet:** migration 16 waits for the owner's Supabase session; the tools need the API key.

## 2026-11-24: Phase 11 (service request workflows), nothing applied to Supabase

- **Database:** migration 17 `workflows` (local, 20 DB tests, 257 total). It adds:
  - request forms with drafts and published versions that never change; requests keep their version;
  - tracking numbers, a status flow with required messages, comments, internal notes and assignment, using the ticket permissions;
  - request notifications (the notification list now covers tickets and requests);
  - the form-suggestion settings and gate, and workflow counts in analytics.
- **Design decision (ADR-031):** a confirmation step before every submission; nobody processes their own request; the AI only chooses and pre-fills a form, never ticks confirmations and never submits.
- **App:**
  - Service requests (forms, AI suggestion, form with review step, tracking);
  - Requests & workflows (queue, request page, form builder, settings);
  - analytics card.
- **Found while building:**
  - the existing notification list parsed all entries at once, so a single request notification would have emptied it (now entry by entry);
  - right-to-left alignment of answers in another script, and a wrong label on assignment events (both from the visual check);
  - dev mode did not hydrate in this environment, so the visual check of the review step ran on a production build.
- **Not live yet:** migration 17 waits for the owner's Supabase session; suggestions need the API key.

## 2026-11-24: Phase 12 (campus map and assistant), nothing applied to Supabase

- **Database:** migration 18 `campus` (local, 9 DB tests, 266 total): locations with buildings, hours, accessibility facts, contact and other names; search that folds Arabic letter variants and ignores question words; campus answers settings and gate; the answers' cost in analytics.
- **Design decision (ADR-032):** a directory first; a simple plan drawn from coordinates instead of third-party map tiles; "not recorded" instead of guesses; AI answers only from location records, with "open now" computed by the app.
- **App:** the campus directory with search and the map, location pages, location management, the campus answers settings and question box.
- **Found while building:** in Arabic pages the map labels overlapped their markers (SVG text follows the page direction); a search for "office" in Arabic also matches "library" (the same root), which is kept and ranked lower on purpose.
- **Not live yet:** migration 18 waits for the owner's Supabase session; answers need the API key.

