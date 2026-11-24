# Security Plan

## 1. Principles

Least privilege · defense in depth · secure by default · data minimization · auditability ·
no secrets in code · fail closed.

## 2. Controls by area

| Area | Control | Status |
| --- | --- | --- |
| Tenant isolation | RLS on all tables, composite FKs, DAL membership checks, isolation test suite | Designed (Phase 2 gate) |
| Authentication | Supabase Auth, HttpOnly cookies, server-verified sessions, MFA for admins (Phase 16) | UI + wiring in Phase 1; live in Phase 2 |
| Authorization | Permission RBAC + departments + features, server-side only | Designed; Phase 2–3 |
| Input validation | zod schemas on every Server Action and Route Handler; length limits | Phase 1 (forms) onward |
| Output encoding / XSS | React escaping; no `dangerouslySetInnerHTML` with untrusted content; Markdown in AI answers is rendered with a sanitizing renderer (Phase 5) | Ongoing |
| CSS injection | Tenant colors accept strict hex only (`theme.ts`), unit-tested | Phase 1 ✔ |
| CSRF | Server Actions use POST with Origin checks by Next.js; SameSite=Lax cookies; route handlers that mutate require POST + origin check | Phase 1 ✔ / ongoing |
| Open redirect | `safeRedirectPath()` on every `next`/`redirectTo` parameter | Phase 1 ✔ |
| SQL injection | Supabase query builder / parameterized RPCs only; the AI never writes SQL | By design |
| Security headers | CSP, HSTS, X-Frame-Options DENY, frame-ancestors 'none', nosniff, Referrer-Policy, Permissions-Policy | Phase 1 ✔ (static CSP; nonce-based CSP for authenticated areas in Phase 16) |
| Rate limiting | Per IP / user / tenant on auth, forms, AI endpoints | Phase 1 in-memory ✔; shared store before production |
| Abuse prevention | Cloudflare Turnstile on anonymous chat and forms; AI budgets | Phase 5–6 |
| Secrets | Env vars only; `server-only` modules; no service-role key in request paths; integration credentials in Supabase Vault | Phase 1 ✔ / Phase 14 |
| File security | Private buckets, type + magic-byte validation, size limits, signed URLs with short TTL | Phase 4 |
| Prompt injection | Documents are data; tools re-authorize; no raw SQL or URL tools; eval suite | Phase 5 |
| Audit logging | Append-only `audit_logs` for sensitive actions (see §5) | Phase 2 |
| Logging hygiene | Structured logs with automatic redaction of secrets/PII keys | Phase 1 ✔ |
| Error handling | Users see safe messages plus a reference ID; details go to server logs | Phase 1 ✔ |
| Dependencies | `npm audit` in CI; Dependabot; minimal dependency footprint | Phase 1 / CI |

## 3. Data classification

| Class | Examples | Handling |
| --- | --- | --- |
| Public | Program descriptions, public FAQs | Retrievable by anonymous visitors of that tenant |
| Internal | Staff procedures, internal memos | Staff-only visibility |
| Confidential | Ticket internal notes, HR documents, integration configs | Restricted roles; never sent to AI unless the user is authorized |
| Personal | Student identity, tickets, conversations, leads | Minimized; owner + authorized staff; retention limits; deletion on request |
| Secret | API keys, service-role key, integration credentials | Env/Vault only; never logged; never sent to the browser or the AI |

## 4. Privacy and AI safety

- No training on tenant data. AI providers are configured for API use under their commercial terms.
  Retention options are reviewed per tenant contract.
- PII minimization in prompts: the assistant receives only the fields a tool returns, never whole records.
- A student asking about another student's data is refused by the tools and by RLS.
- Consequential actions require explicit user confirmation. Official decisions are never made by the AI.
- Leads are captured only with explicit consent, which is stored with timestamp and wording version.
- Academic assistant (ADR-029): study aids and quiz results are private to the student. Quiz answer keys are not readable by clients and are graded in the database. Teachers see class figures only, with accuracy shown from 5 students. Course materials are readable only inside their course.
- AI quality review (ADR-028): reviewers see single flagged exchanges, never who asked. Contact details, links and long numbers are redacted in the database. Answers built from documents the reviewer cannot read are withheld. People using the assistants are told that this review may happen.

## 5. Audited actions

User invited/created/removed · role or permission change · department membership change · tenant
created/suspended/archived · branding published · feature toggled · subscription/plan change · document
uploaded/replaced/deleted/visibility changed · integration configured · support access granted/used ·
data export · retention deletion · AI configuration change.

## 6. Incident basics (Phase 17)

Contacts, severity levels, key rotation runbook (Supabase keys, AI keys), tenant notification template,
and a post-incident review template.

## 7. Phase 16 review checklist (abbreviated)

RLS coverage report (every table has policies and tests) · secret scan · dependency audit · auth flows
(MFA, lockout, reset) · nonce CSP for app routes · rate limits on a shared store · file upload fuzzing ·
prompt-injection eval pass · log review for PII · backup restore drill.

**Status (2026-11-24):** see `docs/security-review.md`. Done: coverage report, secret scan, dependency
audit, nonce CSP, shared rate limits, upload fuzzing, log review, two-step sign-in (built and tested
locally, not live). Not done: the prompt-injection eval (needs the API key) and the backup restore
drill (needs the production project; `docs/runbooks/backup-restore.md`).

## 8. Observability

`src/lib/logger.ts` emits JSON logs in production with `level`, `msg`, `time`, `requestId`, and
contextual fields. Keys such as `password`, `token`, `authorization`, `cookie`, `apiKey`, `secret`, and
`email` are redacted automatically. AI calls emit `ai_usage_events` rows (Phase 5) rather than logging prompts.
