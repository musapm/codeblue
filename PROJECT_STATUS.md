# Project Status

_Last updated: 2026-11-23 (Phase 9)_

## Honest summary

UniAgent AI now has a **tested multi-tenant foundation plus real university management**:
- **Platform owners/admins** create universities, invite their owners, control status and features, and grant time-limited, read-only support access.
- **Universities** manage members (roles, departments, suspension), departments, their profile, and branding with logo.
- **Everything is audited** by database triggers.
- **Verification:** the full onboarding path was tested live against the dedicated Supabase project "agent".

**Knowledge base (Phase 4):** verified live.

**Student assistant (Phase 5):** built and tested locally. Students ask questions, and answers come only from published documents, with numbered sources that open the cited page. Its database (migration 10) is **applied to "agent"** and verified. It cannot answer yet because no Anthropic API key is set. The live AI eval has not been run.

**Admissions (Phase 6):** built and tested; the database is live and verified. It includes:
- a programs catalogue;
- a public admissions page for each university, with an inquiry form that records consent;
- an admissions assistant for visitors;
- an inquiry pipeline for staff (stages, assignment, notes, history, deletion on request);
- analytics from stored data only.
Visitors need **anonymous sign-ins enabled** in Supabase Auth (currently disabled), and the assistant needs the API key.

**Tickets & human handoff (Phase 7):** built and tested locally; **migration 13 is not applied** to "agent" yet (you asked to do the Supabase steps later). It includes:
- "My requests" for students and staff (new request, thread, reply, close);
- staff queues by department, a ticket page (reply, status, priority, category, transfer, assignment, internal notes, history), and categories that route requests to departments;
- "Ask a person" in the student chat, with opt-in sharing of the conversation;
- AI help: a request draft from the student's own conversation, and a summary for staff stored as a labelled internal note (both need the API key);
- in-app notifications (header bell and page).

**Admin dashboard & analytics (Phase 8):** built and tested locally; **migration 14 is not applied** yet. It includes:
- an analytics page computed from stored records only: the assistants, knowledge gaps, requests and tickets, knowledge base, admissions inquiries, AI cost against budgets, and AI quality;
- an AI quality page where reviewers handle unanswered questions and answers rated not helpful, one exchange at a time, without seeing who asked;
- the last 7 days on the overview.

**Academic assistant (Phase 9):** built and tested locally; **migration 15 is not applied** yet. It includes:
- courses, with instructors assigned by academic managers and students joining with a code;
- course materials uploaded by instructors through the knowledge pipeline (readable only inside the course);
- AI study aids from those materials (summaries, practice quizzes, flashcards, study plans), switched on per course, labelled as AI-generated and private to each student;
- class figures for instructors that never show an individual student's results.

**Not built yet:** the staff, workflow and campus assistants. Invitations are not emailed yet: the link is shown once to copy and send.

| Phase | Status |
| --- | --- |
| 0: Discovery, architecture, planning | ✅ Complete |
| 1: Foundation & design system | ✅ Complete |
| 2: Auth, tenants & security foundation | ✅ Core complete (isolation gate passed). Auth email settings need your input |
| 3: Super Admin & university management | ✅ **Core complete, verified live.** Deferred: invitation email, custom roles, sign-up domains (see TASKS.md) |
| 4: Knowledge base | ✅ **Core complete, verified live (6/6).** Embeddings need a provider key (ADR-021) |
| 5: Student assistant | 🟡 **Built and tested** (unit, DB, browser); migration 10 applied and verified. Answers need `ANTHROPIC_API_KEY`; the live eval and live chat test are pending |
| 6: Admissions & leads | 🟡 **Built and tested** (unit, DB, browser); migration 11 applied and verified. Visitor flows need anonymous sign-ins (+ Turnstile recommended); the assistant needs `ANTHROPIC_API_KEY` |
| 7: Tickets & human handoff | 🟡 **Built and tested locally** (unit, DB, browser). Migration 13 **not applied**; the AI help needs `ANTHROPIC_API_KEY` |
| 8: Admin dashboard & analytics | 🟡 **Built and tested locally** (unit, DB, browser, visual check with fictional data). Migration 14 **not applied** |
| 9: Academic assistant | 🟡 **Built and tested locally** (unit, DB, browser, visual check of the study components). Migration 15 **not applied**; generation needs `ANTHROPIC_API_KEY` |
| 10–17 | Not started |

## Supabase project "agent"

| Item | Value |
| --- | --- |
| Ref / URL | `zijruhuvzxtuudsvnwgy` · `https://zijruhuvzxtuudsvnwgy.supabase.co` |
| Region / plan | eu-central-1 (Frankfurt) · **Free** (no backups) |
| Schema | 32 tables + private tables, all with RLS. **11 migrations applied**, byte-identical to git (`supabase/README.md`). Migrations 12 (admissions maintenance), 13 (tickets), 14 (analytics) and 15 (academic) are in git only, not applied. pgvector 0.8.2. Buckets `tenant-assets` (public logos) and `tenant-documents` (private originals) |
| Data | 1 fictional demo university ("Northbridge"). The Phase 3 live run's temporary accounts and test universities: see "Cleanup" below |
| Advisors | Only documented, intended findings (`supabase/README.md`) |
| Auth settings | **Not configured yet:** Site URL, redirect URLs, SMTP, email templates (owner action, `docs/authentication.md`) |
| Other projects | CodeBlue and Terma: not accessed, not modified |

**Cleanup (2026-11-23):** all temporary live-test data was removed: accounts, the platform-admin row, test universities, knowledge documents and files. The project again holds 0 users and only the demo university. Audit rows from the test runs stay; the log is append-only by design and contains only fictional `.test` addresses.

## Feature status

### 1. Fully implemented and working (verified)
- Public website (10 pages, en/ar, RTL), platform branding, theme engine.
- **Authentication:** password sign-in, session gate, sign-out (with an optional return path), and registration that returns to the invitation.
- **Multi-tenant database:** RLS on every table, composite same-tenant FKs, append-only audit log written by triggers, support-access grants (≤ 24 h, read-only).
- **Tenant isolation:** 80 database tests (T1–T16 + escalation, ownership, invitations, storage) and live HTTP tests (T18).
- **Platform console:**
  - universities list (aggregate counts only);
  - create a university (+ owner invitation link);
  - lifecycle status (trial/active/suspended/archived) and per-university feature toggles;
  - owner/admin invitations;
  - support-access grant/revoke;
  - platform audit log.
- **Invitations:**
  - 256-bit single-use token, only its SHA-256 hash stored;
  - 1–30 days validity, revocable, and a new invitation replaces the pending one;
  - accepting requires the invited, confirmed email address;
  - no privilege escalation: people can grant only roles whose permissions they hold, and only owners or the platform can grant ownership.
- **University workspace:**
  - members & roles: assign/remove roles and departments, suspend/reactivate, remove;
  - departments (create, edit, archive/restore, Arabic names);
  - audit log viewer;
  - settings (display names en/ar, default language, time zone, support email);
  - branding draft/publish (colors, assistant names, welcome texts in en/ar, monogram) and logo upload (PNG/JPEG/WebP ≤ 1 MB, content-sniffed; SVG refused).
- **Ownership protection:**
  - every university keeps at least one active owner;
  - administrators cannot promote themselves or suspend owners.
- **Support access:** read-only pages (overview, members, settings), banner, immediate revocation.
- Security baseline (headers, validation, redirect guard, redaction), error pages, health endpoint.

### 2. Implemented but not connected to a real backend
- **Student assistant** (chat, settings page, answer pipeline, budget): tested with a local database and a fake model. Its tables and functions are live on "agent". It needs an API key before it can answer anyone.
- **Public admissions (inquiry form and admissions assistant):** live database, but visitors cannot get a session until anonymous sign-ins are enabled; the page then shows programs and says honestly that it cannot receive inquiries yet. Staff pages (inquiries, programs, analytics, settings) work with a normal account.
- **Tickets & handoff (Phase 7):** pages, actions and database are tested locally (26 DB tests), but migration 13 is not on "agent", so the pages would fail against it until it is applied. Email notifications are not built (in-app only).
- **Academic assistant (Phase 9):** tested locally (28 DB tests); migration 15 is not on "agent", so these pages would fail there until it is applied. Study aids also need the API key.
- **Analytics & AI quality (Phase 8):** tested locally (25 DB tests); migration 14 is not on "agent", so these pages would fail there until it is applied. The overview fails soft (it shows that figures are unavailable).
- **Contact/demo form:** validates; not stored (`platform_inquiries` not built).
- **Rate limiting:** in-memory per instance (now also on invitations, uploads, university creation).

### 3. UI-only / placeholder
Module pages for staff, workflows, campus,
integrations; platform plans/usage/AI/settings (labelled "Planned · Phase N").
Chat previews on the marketing site (static, labelled). Privacy/Terms drafts.

### 4. Planned but not implemented
Invitation emails (needs transactional email) · custom roles editor · sign-up domain rules and
self-service join · staff, workflow and campus assistants · students' own uploads and instructor-shared quizzes · lead export for access requests, retention rules · ticket attachments, SLAs and assignment rules · analytics rollups, CSV export and email digests · AI clustering of gap questions · email notifications · subscriptions and plans · voice · integrations · backups · CI, monitoring.

### 5. Broken or incomplete
| Issue | Severity |
| --- | --- |
| Email-based auth flows (sign-up confirmation, password reset) unverified: need Supabase Auth URL, SMTP and template settings | High (owner action) |
| In-memory rate limiting, IP from a spoofable header | High before launch |
| No backups on the Free plan | High before real data |
| Replaced logo files are not deleted from storage (only the reference changes) | Low (cleanup job later) |
| Deleting the account of a university's only owner is blocked by the owner guard (transfer ownership first). No self-service account deletion exists yet | Low (by design; document in support runbook) |
| Assistant turns, ticket AI usage and study aids are recorded with the user's own session (no service-role worker yet): a user calling the API directly could add records to their own conversation or study aids, or understate usage (ADR-024, ADR-027, ADR-029) | Medium before launch |
| Anonymous visitor accounts are not cleaned up yet (they accumulate in Supabase Auth; inquiries survive their deletion) | Low (cleanup job, TASKS.md) |
| Assistant system prompt is below the 512-token caching minimum, so it is not cached (small cost effect) | Low |
| CSP allows inline scripts | Medium (Phase 16) |
| Duplicate `id="main"` after switching workspaces | Low |

## Test results (2026-11-23)

| Suite | Result |
| --- | --- |
| Typecheck / lint / build | ✅ |
| Unit + component (`npm test`) | ✅ 191/191 (incl. both assistants, the ticket AI and the study aids with a fake database and fake model, analytics helpers) |
| Database isolation (`npm run test:db`) | ✅ 221/221 (local PostgreSQL 16; migrations 10–15, anonymous visitors, 26 ticket, 25 analytics and 28 academic tests) |
| Browser e2e, preview mode (`npm run test:e2e`) | ✅ 115/115 (incl. course and academic pages, analytics and AI quality pages, ticket, request and notification pages, admissions staff pages, both answer endpoints refusing cross-site requests, robots/sitemap, accessibility) |
| Live AI eval (`npm run test:eval`, 13 student + 10 admissions cases) | ⏸ Not run: needs `ANTHROPIC_API_KEY` and your approval to spend (~USD 0.15–0.50 per run) |
| **Live e2e against "agent"** (`e2e/live`, opt-in) | ✅ Phase 3 onboarding path 9/9: steps 1–7 in one run, then 8–9 after a test-selector fix and the support-access fix below. Phase 2 regression 4/4 (the 2 owner cases need a demo-tenant owner and were skipped, see `docs/testing.md`) |

Real defects found by the live run and fixed:
- Support sessions had no visible pages. They now get a fixed read-only page set (ADR-019).
- An owner was offered a button to remove their own owner role. It is now hidden; the database already refused it if they were the last owner.

## Decisions and actions needed from you
0. **Phases 6–9:** **apply migrations 12, 13, 14 and 15** together when you do the Supabase steps; I can do all four in one session. Then:
   - turn on the `ticketing` feature for a university and add categories under Tickets → Categories & routing;
   - give someone the "AI quality reviewer" role if you want reviews done by someone other than the owner;
   - give teaching staff the new "Faculty member" role, create a course under Academic assistant, and assign its instructor.
   **Privacy notice:** both assistants now tell people that unanswered and rated questions may be reviewed without their identity (ADR-028). Please confirm this matches your privacy policy, and add it to the university's own notice before launch.
   **Phase 6:**
   - **Enable anonymous sign-ins** in Supabase Auth: Authentication → Sign In / Providers. Without them, visitors cannot send inquiries or use the admissions assistant.
   - **Recommended:** Cloudflare Turnstile. Put the site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the secret key in Supabase Auth CAPTCHA protection, and enable both together (`docs/authentication.md`, steps 7–8).
   - **Turn on the admissions feature and publish a page** for a university, when you want a live run with real data.
   - **Migration 12** (audited inquiry export and anonymous-visitor cleanup) is ready in git, but **not applied**. I can apply it whenever you do the Supabase steps. Then enable `pg_cron` and schedule the cleanup (`supabase/README.md`).
   **Phase 5:**
   - **Set `ANTHROPIC_API_KEY`** in the environment settings. Note that anyone using the environment can read it. Then start a new session.
   - **Approve the eval run** (about USD 0.15–0.50).
1. **Enable leaked-password protection** in Supabase Auth (security advisor finding).
2. **Configure Supabase Auth** (Site URL, redirect URLs incl. `/auth/callback`, SMTP provider, email templates): `docs/authentication.md`.
3. **Become platform owner:** sign up, confirm your email, run `supabase/seed/bootstrap_platform_owner.sql` with your email.
4. **Transactional email provider** (e.g. Resend, Postmark, SES) for invitation emails and auth emails.
5. **Sign-up policy:** invitation-only (current behaviour) or allow approved email domains to self-join?
6. **Embeddings provider** (Voyage AI, OpenAI or Cohere) for semantic search.
7. Plan upgrade timing (before the first pilot with real data); Frankfurt region OK?

## Phase 4 status (2026-11-23)
- **Migration 8 `knowledge` applied to "agent"** (byte-identical; pgvector 0.8.2, private bucket, 3 storage policies).
- **Live run against "agent": 6/6 passed.** It covered:
  - an English PDF (text per page, publishing) and an Arabic PDF read in correct reading order;
  - a staff-only DOCX, a scanned PDF flagged "Needs OCR", and a disguised file refused by content;
  - English and Arabic test search;
  - **T17 live:** a student retrieves members documents but never staff-only ones, cannot read chunks directly, and cannot search another university;
  - a new version replacing the old passages, and deletion.
- **Defects the live run found:**
  - **Files of deleted documents stayed in storage.** Storage only deletes files the caller can read, and the document row was already gone. Fixed by migration 9 (`knowledge_file_cleanup`, applied and byte-identical, 99/99 DB tests). The fix was verified live: the 2 leftover files and all test documents were removed through the normal API path.
  - A race in the test itself (Next.js keeps the previous page mounted but hidden). The test was fixed; the product was not affected.
- **Other test suites:** 117 unit (incl. real PDF/DOCX fixtures) and 76 browser (preview) tests pass.
- **Not done:** embeddings (needs a provider key and a benchmark, ADR-021), OCR, a background worker for large files (ADR-022).

## Phase 5 status (2026-11-23)
- **Built:**
  - migration 10 `assistant` (9 DB tests). **Applied to "agent"** as version `20261123124604`: byte-identical, RLS and grants checked live, security advisors show only the documented intended findings, and the generated types match;
  - the answer pipeline (`src/lib/ai`): retrieval as the student, no model call without passages, Claude Opus 5.5 with citable `search_result` blocks, refusal fallbacks, citations mapped to pages, and usage with estimated cost;
  - the streaming endpoint `/api/assistant/[tenant]`;
  - the student chat `/app/[tenant]/ask` and the settings page `/app/[tenant]/assistant`;
  - the eval suite `evals/assistant` (13 cases).
- **Verified:** typecheck, lint and build pass, plus unit 143, DB 108 and browser 82. An eval run with a deliberately invalid key confirmed that the API is reachable from this environment and that errors are handled (no cost).
- **Not verified yet:** real answers from the model, citation quality in Arabic and English, cost per answer, and the chat against "agent". These need the API key; no results are claimed until then.

## Phase 6 status (2026-11-23)
- **Built:**
  - migration 11 `admissions` (28 DB tests). Applied to "agent" as version `20261123151820`: byte-identical, advisors show only documented findings, and the hand-written types match the live columns;
  - public pages `/[lang]/admissions/[tenant]` (programs, program details, the admissions assistant, the inquiry form with consent);
  - the staff workspace `/app/[tenant]/admissions` (inquiries with filters, inquiry detail with pipeline, notes, history and deletion, programs, analytics, settings);
  - anonymous visitor sessions and optional Turnstile (ADR-025);
  - the consent and erasure rules (ADR-026).
- **Verified:**
  - typecheck, lint and build pass, plus unit 156, DB 136 and browser 90;
  - a visual check of the public page and charts (en/ar) with fictional data;
  - live probes: anonymous callers cannot submit inquiries or read the tables, the unpublished demo page returns nothing, and anonymous sign-ins are disabled on the project.
- **Follow-ups (2026-11-23):**
  - migration 12 (local, 6 DB tests): an audited JSON export of an inquiry for access requests, and the anonymous-visitor cleanup;
  - admissions eval (10 cases, needs the key);
  - a live admissions spec (written, not run);
  - `robots.txt` and `sitemap.xml`;
  - the Inquiries tab stays highlighted on inquiry pages.
- **Not verified live:**
  - a visitor sending an inquiry or chatting, which needs anonymous sign-ins (and the API key for the assistant);
  - staff using the pipeline against "agent". The database tests cover the same rules, but no live run has been done.

## Phase 7 status (2026-11-23)
- **Built:**
  - migration 13 `tickets` (26 DB tests, **local only**);
  - requester pages `/app/[tenant]/requests` (list, new request with an optional AI draft, thread, reply, close);
  - staff pages `/app/[tenant]/tickets` (queues, ticket page, categories & routing);
  - "Ask a person" in the student chat;
  - the notification bell and page;
  - the privacy and AI rules (ADR-027).
- **Verified:**
  - typecheck, lint and build pass, plus unit 168, DB 168 and browser 100;
  - a visual check (en/ar) of the thread and forms with fictional data.
- **Found and fixed:** NULL-returning permission helpers let staff without the permission add notes in other departments or unassign colleagues (DB regression test).
- **Not verified:**
  - anything against "agent" (migration 13 not applied);
  - the AI draft and summary with a real model (no key; no eval set yet);
  - the full staff ticket page with real data. It was checked only through its parts.

## Phase 8 status (2026-11-23)
- **Built:**
  - migration 14 `analytics` (25 DB tests, **local only**);
  - the analytics page, the AI quality page, and the last 7 days on the overview;
  - shared chart components;
  - the review notice in both assistants;
  - the privacy rules (ADR-028).
- **Verified:**
  - typecheck, lint and build pass, plus unit 176, DB 193 and browser 109;
  - a visual check (en/ar) of the dashboard and the review queue with fictional data, including keyboard focus on a chart.
- **Found and fixed:** a formatting function passed to a client component (fails only with data), money shown as `$6.8`, and two accessibility issues in the old admissions charts.
- **Not verified:** anything against "agent" (migration 14 not applied); real figures from real use.

## Phase 9 status (2026-11-23)
- **Built:**
  - migration 15 `academic` (28 DB tests, **local only**);
  - My courses, the course page, the study aids (quiz, flashcards, study plan);
  - course management and the academic admin;
  - AI generation of study aids from course materials;
  - the academic card in analytics;
  - the Faculty member role;
  - the rules in ADR-029.
- **Verified:**
  - typecheck, lint and build pass, plus unit 191, DB 221 and browser 115;
  - every Phase 4 knowledge test still passes after the access helpers gained a course branch;
  - a visual check (en/ar) of the study-tool form, quiz, flashcards and study plan with fictional data.
- **Not verified:**
  - anything against "agent" (migration 15 not applied);
  - generation with a real model (no key; no eval set yet);
  - the full course pages with real data. They were checked only through their parts.

## Next steps
1. Go-live for Phases 5–9:
   - apply migrations 12, 13, 14 and 15;
   - set the API key and run the eval;
   - enable anonymous sign-ins (+ Turnstile);
   - then run live tests against "agent": a student chat, a visitor inquiry and an admissions question, the staff pipeline, a request handled end to end (reply, note, transfer, notifications, AI draft and summary), the analytics and AI quality pages on that real activity, and a course end to end (material, join, each study aid, a quiz). Clean up the test data afterwards.
2. Phase 3 follow-ups: invitation email (after the provider decision), custom roles editor, sign-up domains.
3. Operational: CI pipeline (`check` + `test:db` + e2e), error tracking, shared rate limiting, inquiry storage.
