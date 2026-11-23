# Project Status

_Last updated: 2026-11-23 (Phase 5)_

## Honest summary

UniAgent AI now has a **tested multi-tenant foundation plus real university management**:
- **Platform owners/admins** create universities, invite their owners, control status and features, and grant time-limited, read-only support access.
- **Universities** manage members (roles, departments, suspension), departments, their profile, and branding with logo.
- **Everything is audited** by database triggers.
- **Verification:** the full onboarding path was tested live against the dedicated Supabase project "agent".

**Knowledge base (Phase 4):** verified live.

**Student assistant (Phase 5):** built and tested locally. Students ask questions, and answers come only from published documents, with numbered sources that open the cited page. It is **not live yet**: migration 10 must be applied to "agent", and an Anthropic API key must be set. The live AI eval has not been run.

**Not built yet:** tickets, analytics, admissions and the other assistants. Invitations are not emailed yet: the link is shown once to copy and send.

| Phase | Status |
| --- | --- |
| 0: Discovery, architecture, planning | ✅ Complete |
| 1: Foundation & design system | ✅ Complete |
| 2: Auth, tenants & security foundation | ✅ Core complete (isolation gate passed). Auth email settings need your input |
| 3: Super Admin & university management | ✅ **Core complete, verified live.** Deferred: invitation email, custom roles, sign-up domains (see TASKS.md) |
| 4: Knowledge base | ✅ **Core complete, verified live (6/6).** Embeddings need a provider key (ADR-021) |
| 5: Student assistant | 🟡 **Built and tested locally** (unit, DB, browser). Live verification needs migration 10 applied and `ANTHROPIC_API_KEY` |
| 6–17 | Not started |

## Supabase project "agent"

| Item | Value |
| --- | --- |
| Ref / URL | `zijruhuvzxtuudsvnwgy` · `https://zijruhuvzxtuudsvnwgy.supabase.co` |
| Region / plan | eu-central-1 (Frankfurt) · **Free** (no backups) |
| Schema | 22 tables + private templates, all with RLS. **9 migrations**, byte-identical to git (`supabase/README.md`). pgvector 0.8.2. Buckets `tenant-assets` (public logos) and `tenant-documents` (private originals). **Migration 10 (`assistant`, 5 tables) is in git but not applied yet** |
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
- **Student assistant** (chat, settings page, answer pipeline, budget): tested with a local database and a fake model. It needs migration 10 on "agent" and an API key before it can answer anyone.
- **Contact/demo form:** validates; not stored (`platform_inquiries` not built).
- **Rate limiting:** in-memory per instance (now also on invitations, uploads, university creation).

### 3. UI-only / placeholder
Module pages for admissions, academic, staff, tickets, workflows, campus, analytics, quality,
integrations; platform plans/usage/AI/settings (labelled "Planned · Phase N").
Chat previews on the marketing site (static, labelled). Privacy/Terms drafts.

### 4. Planned but not implemented
Invitation emails (needs transactional email) · custom roles editor · sign-up domain rules and
self-service join · admissions, academic, staff, workflow and campus assistants · tickets · analytics and
AI-quality review · notifications · subscriptions and plans · voice · integrations · backups · CI, monitoring.

### 5. Broken or incomplete
| Issue | Severity |
| --- | --- |
| Email-based auth flows (sign-up confirmation, password reset) unverified: need Supabase Auth URL, SMTP and template settings | High (owner action) |
| In-memory rate limiting, IP from a spoofable header | High before launch |
| No backups on the Free plan | High before real data |
| Replaced logo files are not deleted from storage (only the reference changes) | Low (cleanup job later) |
| Deleting the account of a university's only owner is blocked by the owner guard (transfer ownership first). No self-service account deletion exists yet | Low (by design; document in support runbook) |
| Assistant turns are recorded with the student's own session (no service-role worker yet): a student calling the API directly could add records to their own conversation or understate usage (ADR-024) | Medium before launch |
| Assistant system prompt is below the 512-token caching minimum, so it is not cached (small cost effect) | Low |
| CSP allows inline scripts | Medium (Phase 16) |
| Duplicate `id="main"` after switching workspaces | Low |

## Test results (2026-11-23)

| Suite | Result |
| --- | --- |
| Typecheck / lint / build | ✅ |
| Unit + component (`npm test`) | ✅ 143/143 (incl. the assistant turn with a fake database and fake model) |
| Database isolation (`npm run test:db`) | ✅ 108/108 (local PostgreSQL 16; includes migration 10) |
| Browser e2e, preview mode (`npm run test:e2e`) | ✅ 82/82 (incl. chat and assistant settings pages, cross-site refusal of the answer endpoint, accessibility) |
| Live AI eval (`npm run test:eval`, 13 cases) | ⏸ Not run: needs `ANTHROPIC_API_KEY` and your approval to spend (~USD 0.15–0.50 per run) |
| **Live e2e against "agent"** (`e2e/live`, opt-in) | ✅ Phase 3 onboarding path 9/9: steps 1–7 in one run, then 8–9 after a test-selector fix and the support-access fix below. Phase 2 regression 4/4 (the 2 owner cases need a demo-tenant owner and were skipped, see `docs/testing.md`) |

Real defects found by the live run and fixed:
- Support sessions had no visible pages. They now get a fixed read-only page set (ADR-019).
- An owner was offered a button to remove their own owner role. It is now hidden; the database already refused it if they were the last owner.

## Decisions and actions needed from you
0. **Phase 5:**
   - **Apply migration 10** (`assistant`): I will request it, and you confirm the Supabase prompt.
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
  - migration 10 `assistant` (local, 9 DB tests);
  - the answer pipeline (`src/lib/ai`): retrieval as the student, no model call without passages, Claude Opus 5.5 with citable `search_result` blocks, refusal fallbacks, citations mapped to pages, and usage with estimated cost;
  - the streaming endpoint `/api/assistant/[tenant]`;
  - the student chat `/app/[tenant]/ask` and the settings page `/app/[tenant]/assistant`;
  - the eval suite `evals/assistant` (13 cases).
- **Verified:** typecheck, lint and build pass, plus unit 143, DB 108 and browser 82. An eval run with a deliberately invalid key confirmed that the API is reachable from this environment and that errors are handled (no cost).
- **Not verified yet:** real answers from the model, citation quality in Arabic and English, cost per answer, and the chat against "agent". These need the migration and the key; no results are claimed until then.

## Next steps
1. Phase 5 go-live: apply migration 10, set the API key, run the eval, then write and run a live chat test against "agent" (student asks, sources open, staff-only documents are never cited).
2. Phase 3 follow-ups: invitation email (after the provider decision), custom roles editor, sign-up domains.
3. Operational: CI pipeline (`check` + `test:db` + e2e), error tracking, shared rate limiting, inquiry storage.
