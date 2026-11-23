# Project Status

_Last updated: 2026-11-23 (Phase 4)_

## Honest summary

UniAgent AI now has a **tested multi-tenant foundation plus real university management**:
- **Platform owners/admins** create universities, invite their owners, control status and features, and grant time-limited, read-only support access.
- **Universities** manage members (roles, departments, suspension), departments, their profile, and branding with logo.
- **Everything is audited** by database triggers.
- **Verification:** the full onboarding path was tested live against the dedicated Supabase project "agent".

**Not built yet:** AI, the knowledge base, document search, tickets and analytics. Every chat UI is still a labelled illustration. Invitations are not emailed yet: the link is shown once to copy and send.

| Phase | Status |
| --- | --- |
| 0: Discovery, architecture, planning | ✅ Complete |
| 1: Foundation & design system | ✅ Complete |
| 2: Auth, tenants & security foundation | ✅ Core complete (isolation gate passed). Auth email settings need your input |
| 3: Super Admin & university management | ✅ **Core complete, verified live.** Deferred: invitation email, custom roles, sign-up domains (see TASKS.md) |
| 4: Knowledge base | ✅ **Core complete, verified live (6/6).** Migration 9 (file-cleanup fix) awaiting your confirmation; embeddings need a provider key |
| 5–17 | Not started |

## Supabase project "agent"

| Item | Value |
| --- | --- |
| Ref / URL | `zijruhuvzxtuudsvnwgy` · `https://zijruhuvzxtuudsvnwgy.supabase.co` |
| Region / plan | eu-central-1 (Frankfurt) · **Free** (no backups) |
| Schema | 18 tables + private templates, all with RLS. **7 migrations**, byte-identical to git (`supabase/README.md`). Storage bucket `tenant-assets` (logos, per-tenant write policies) |
| Data | 1 fictional demo university ("Northbridge"). The Phase 3 live run's temporary accounts and test universities: see "Cleanup" below |
| Advisors | Only documented, intended findings (`supabase/README.md`) |
| Auth settings | **Not configured yet:** Site URL, redirect URLs, SMTP, email templates (owner action, `docs/authentication.md`) |
| Other projects | CodeBlue and Terma: not accessed, not modified |

**Cleanup:** the test logo was deleted through the Storage API. Deleting the temporary `e2e-*@uniagent.test` accounts, the temporary platform-admin row, and the universities `e2e-live-university` and `e2e-other-university` is waiting for your confirmation in the Supabase tool. Audit rows from the test run stay; the log is append-only by design and contains only fictional `.test` addresses.

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
- **Contact/demo form:** validates; not stored (`platform_inquiries` not built).
- **Rate limiting:** in-memory per instance (now also on invitations, uploads, university creation).

### 3. UI-only / placeholder
Module pages for assistant, admissions, academic, staff, tickets, knowledge, workflows, campus,
analytics, quality, integrations; platform plans/usage/AI/settings (labelled "Planned · Phase N").
Chat previews (static). Privacy/Terms drafts.

### 4. Planned but not implemented
Invitation emails (needs transactional email) · custom roles editor · sign-up domain rules and
self-service join · AI integration and all assistants · knowledge base · RAG and citations · tickets ·
analytics · notifications · subscriptions and plans · voice · integrations · backups · CI, monitoring.

### 5. Broken or incomplete
| Issue | Severity |
| --- | --- |
| Email-based auth flows (sign-up confirmation, password reset) unverified: need Supabase Auth URL, SMTP and template settings | High (owner action) |
| In-memory rate limiting, IP from a spoofable header | High before launch |
| No backups on the Free plan | High before real data |
| Replaced logo files are not deleted from storage (only the reference changes) | Low (cleanup job later) |
| Deleting the account of a university's only owner is blocked by the owner guard (transfer ownership first). No self-service account deletion exists yet | Low (by design; document in support runbook) |
| CSP allows inline scripts | Medium (Phase 16) |
| Duplicate `id="main"` after switching workspaces | Low |

## Test results (2026-11-22)

| Suite | Result |
| --- | --- |
| Typecheck / lint / build | ✅ |
| Unit + component (`npm test`) | ✅ 97/97 |
| Database isolation (`npm run test:db`) | ✅ 80/80 |
| Browser e2e, preview mode (`npm run test:e2e`) | ✅ 72/72 (incl. new management pages, invitation page, accessibility checks) |
| **Live e2e against "agent"** (`e2e/live`, opt-in) | ✅ Phase 3 onboarding path 9/9: steps 1–7 in one run, then 8–9 after a test-selector fix and the support-access fix below. Phase 2 regression 4/4 (the 2 owner cases need a demo-tenant owner and were skipped, see `docs/testing.md`) |

Real defects found by the live run and fixed:
- Support sessions had no visible pages. They now get a fixed read-only page set (ADR-019).
- An owner was offered a button to remove their own owner role. It is now hidden; the database already refused it if they were the last owner.

## Decisions and actions needed from you
1. **Confirm migration 9** (Supabase prompt) and the **cleanup** of the temporary live-test data in "agent".
2. **Enable leaked-password protection** in Supabase Auth (security advisor finding).
3. **Configure Supabase Auth** (Site URL, redirect URLs incl. `/auth/callback`, SMTP provider, email templates): `docs/authentication.md`.
4. **Become platform owner:** sign up, confirm your email, run `supabase/seed/bootstrap_platform_owner.sql` with your email.
5. **Transactional email provider** (e.g. Resend, Postmark, SES) for invitation emails and auth emails.
6. **Sign-up policy:** invitation-only (current behaviour) or allow approved email domains to self-join?
7. **Embeddings provider** (Voyage AI, OpenAI or Cohere) for semantic search.
8. Plan upgrade timing (before the first pilot with real data); Frankfurt region OK?

## Phase 4 status (2026-11-23)
- **Migration 8 `knowledge` applied to "agent"** (byte-identical; pgvector 0.8.2, private bucket, 3 storage policies).
- **Live run against "agent": 6/6 passed.** It covered:
  - an English PDF (text per page, publishing) and an Arabic PDF read in correct reading order;
  - a staff-only DOCX, a scanned PDF flagged "Needs OCR", and a disguised file refused by content;
  - English and Arabic test search;
  - **T17 live:** a student retrieves members documents but never staff-only ones, cannot read chunks directly, and cannot search another university;
  - a new version replacing the old passages, and deletion.
- **Defects the live run found:**
  - **Files of deleted documents stayed in storage.** Storage only deletes files the caller can read, and the document row was already gone. Fixed by migration 9 (`knowledge_file_cleanup`, tested locally, 99/99 DB tests), which is **waiting for your confirmation** in the Supabase prompt. 2 leftover test files will be removed after it is applied.
  - A race in the test itself (Next.js keeps the previous page mounted but hidden). The test was fixed; the product was not affected.
- **Other test suites:** 117 unit (incl. real PDF/DOCX fixtures) and 76 browser (preview) tests pass.
- **Not done:** embeddings (needs a provider key and a benchmark, ADR-021), OCR, a background worker for large files (ADR-022).

## Next steps
1. Apply migration 8 and run `e2e/live/live-knowledge.spec.ts`; then Phase 5 (student assistant with citations).
2. Phase 3 follow-ups: invitation email (after the provider decision), custom roles editor, sign-up domains.
3. Operational: CI pipeline (`check` + `test:db` + e2e), error tracking, shared rate limiting, inquiry storage.
