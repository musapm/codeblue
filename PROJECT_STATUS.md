# Project Status

_Last updated: 2026-11-22_

## Honest summary

UniAgent AI now has a **real, tested multi-tenant security foundation**:
- **Database:** a live database in the dedicated Supabase project "agent", with tenant isolation enforced and tested at the database level.
- **Access:** real sign-in, and real role-based access in the app.
- **AI and university services:** **not built yet.** There is no AI, knowledge base, document search, tickets or analytics. Every chat UI is still a labelled illustration.

| Phase | Status |
| --- | --- |
| 0: Discovery, architecture, planning | ✅ Complete |
| 1: Foundation & design system | ✅ Complete (the audit defects are fixed) |
| 2: Auth, tenants & security foundation | ✅ **Core complete; isolation gate passed.** Open items below need your input (Auth email settings) or are operational |
| 3: Super Admin & university management (UI) | ⏭ Next |
| 4–17 | Not started |

## Supabase project "agent"

| Item | Value |
| --- | --- |
| Ref / URL | `zijruhuvzxtuudsvnwgy` · `https://zijruhuvzxtuudsvnwgy.supabase.co` |
| Region / plan | eu-central-1 (Frankfurt) · **Free** (no backups) |
| Schema | 18 tables in `public` + 2 private template tables, all with RLS. 5 migrations, byte-identical to git (`supabase/README.md`) |
| Data | 1 fictional demo university ("Northbridge", 7 departments, 13 roles). **0 users** (temporary test accounts deleted) |
| Advisors | Only documented, intended findings (see `supabase/README.md`) |
| Auth settings | **Not configured yet:** Site URL, redirect URLs, SMTP, email templates (owner action, `docs/authentication.md`) |
| Other projects | CodeBlue and Terma: not accessed, not modified |

## Feature status

### 1. Fully implemented and working
- Public website, 10 pages in English and Arabic, with honest "In development" labelling.
- Arabic/English with RTL.
- Platform branding configuration and theme engine.
- **Authentication:** password sign-in, session gate (HTTP 307), sign-out, error handling. Verified live against "agent".
- **Multi-tenant database:**
  - tenants, memberships, roles (13 system templates + custom), permissions (35), departments, invitations (table), features;
  - **RLS on every table**, composite same-tenant FKs, append-only **audit log written by database triggers**;
  - support-access grants (time-boxed, read-only, audited).
- **Tenant isolation:** 50 database tests (T1–T15 + escalation, suspension, support grants, audit, seed) and **live HTTP-level tests (T18)**.
- **Workspace on real data:** university list and tenant context from the database; role-based navigation; **server-side permission gates** on settings, branding and modules; suspended-university page; "No university access yet" page.
- **Super Admin gate:** `platform_admins` + console access check. Platform staff (owner included) **cannot see university content without an audited grant**.
- Security baseline (headers, validation, redirect guard, redaction), error pages, health endpoint.

### 2. Implemented but not connected to a real backend
- **Branding editor:** live preview; **saving/publishing not built** (the database column exists).
- **Contact/demo form:** validates; **not stored** (`platform_inquiries` not built yet).
- **Rate limiting:** in-memory per instance.

### 3. UI-only / placeholder
Module pages for assistant, admissions, academic, staff, tickets, knowledge, workflows, campus, analytics,
quality, members, departments, integrations and audit (labelled "Planned · Phase N"). Chat previews
(static). Platform console modules. Privacy/Terms drafts.

### 4. Planned but not implemented
University management UI (create, invite, roles, departments, audit viewer) · invitation acceptance flow ·
AI model integration · student, admissions, academic and staff assistants · knowledge base upload and
processing · RAG and citations · tickets and handoff · analytics · branding persistence · notifications
and email · subscriptions and plans · voice · integrations · backups and recovery · CI, monitoring and
error tracking.

### 5. Broken or incomplete
| Issue | Severity |
| --- | --- |
| Email-based auth flows (sign-up confirmation, password reset) unverified: they need Supabase Auth URL, SMTP and template settings | High (owner action) |
| In-memory rate limiting, IP from a spoofable header | High before launch |
| No backups on the Free plan | High before real data |
| CSP allows inline scripts | Medium (Phase 16) |
| Duplicate `id="main"` after switching workspaces | Low |

## Test results (2026-11-22)

| Suite | Result |
| --- | --- |
| Typecheck / lint / build | ✅ |
| Unit + component (`npm test`) | ✅ 88/88 |
| Database isolation (`npm run test:db`) | ✅ 50/50 |
| Browser e2e, preview mode (`npm run test:e2e`) | ✅ 58/58 (incl. sign-out regression, accessibility checks) |
| **Live e2e against "agent"** (`e2e/live`, opt-in) | ✅ 6/6: student/owner/outsider flows, T18 cross-tenant, sign-out, Arabic data. Plus a manual check that the platform owner is blocked without a grant |
| Live API probes (anon) | ✅ All tables and functions denied. Private schema not exposed |

## Decisions and actions needed from you
1. **Configure Supabase Auth** (Site URL, redirect URLs, SMTP provider, email templates): steps in `docs/authentication.md`. Choose an email provider.
2. **Become platform owner:** sign up, confirm your email, run `supabase/seed/bootstrap_platform_owner.sql` with your email.
3. **Sign-up policy:** invitation/approved domains only (recommended) or open?
4. **Plan upgrade timing:** before the first pilot with real data.
5. Confirm that Frankfurt is acceptable for target universities.

## Next steps
1. Phase 3: university management UI on top of the new schema (create a university, invite members, assign roles and departments, audit viewer, branding save/publish, support-access grant UI).
2. Operational: CI pipeline (`check` + `test:db` + e2e), error tracking, shared rate limiting, inquiry storage.
3. Then Phase 4 (knowledge base) → Phase 5 (student assistant with real AI and citations).
