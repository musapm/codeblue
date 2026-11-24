# Security review: Phase 16 (2026-11-24)

> Scope: the code on branch `ccr-df7f375e-95dbtr` after Phase 15, and the 23 migrations. Nothing was
> run against the live Supabase project "agent" (migrations 12–23 are not applied there). Findings
> are listed with what was done; items that need the live project, a key or a decision are
> listed as open, not as done.

## 1. Checklist (docs/security.md §7)

| Item | Status | Evidence |
| --- | --- | --- |
| RLS coverage report | ✅ Done, automated | `supabase/tests/coverage.test.ts`: every table has RLS; every public table has policies except two deny-all tables listed on purpose; every SECURITY DEFINER function fixes `search_path`; `anon` reaches only `public_admissions` and `rate_limit_hit`; private tables have no API grants; every table carries the two-step restrictive policy. Runs with `npm run test:db` |
| Secret scan | ✅ Done, repeatable | `npm run security:secrets` scans tracked files and the full git history for real credential formats (`scripts/secret-scan.mjs`): no findings |
| Dependency audit | ✅ Done | `npm audit` (production and development): 0 vulnerabilities |
| Auth flows: MFA, lockout, reset | 🟡 Built and tested locally, not live | Two-step sign-in (TOTP) added and enforced by the database (migration 23); platform staff must use it. Lockout: sign-in attempts limited per email (5 / 10 min) and per IP (20 / 10 min), now shared across instances, plus Supabase Auth's own limits and Turnstile when configured. Reset: link built from the configured site URL (not the Host header), PKCE / token-hash verification, safe redirects. **Not tested against a real Supabase Auth** |
| Nonce CSP for app routes | ✅ Done | `/app` and `/platform` pages get a per-request nonce with `'strict-dynamic'` and no `'unsafe-inline'` scripts; the full browser suite passes under it. Public pages are prerendered and keep `'unsafe-inline'` (a nonce cannot be added at build time) |
| Rate limits on a shared store | ✅ Done (needs `RATE_LIMIT_SECRET`) | Migration 22: counters in Postgres keyed by an HMAC, so no emails, ids or IPs are stored and nobody can fill another person's bucket. Falls back to per-instance memory when not configured |
| File upload fuzzing | ✅ Done | `src/lib/knowledge/fuzz.test.ts`: damaged PDFs and DOCX files, random bytes, hostile text, renamed executables and web pages. Found finding F6 |
| Prompt-injection eval pass | ⛔ Not run | The eval suite has injection cases (`evals/`), but running it needs `ANTHROPIC_API_KEY`, which this environment does not have. No pass is claimed |
| Log review for PII | ✅ Done | The logger now drops free-text and identity fields and masks email addresses inside any string, including database error messages |
| Backup restore drill | ⛔ Not done | Needs the production Supabase project (PITR on the Pro plan). Procedure written: `docs/runbooks/backup-restore.md` |

## 2. Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | High (functional) | `Permissions-Policy: microphone=()` blocked the microphone on our own pages, so voice input (Phase 13) could never work in a browser | Fixed: `microphone=(self)` |
| F2 | High | No two-step sign-in; platform staff accounts protected by a password only | Fixed: TOTP two-step sign-in, enforced by the database for every account that sets it up (aal2 required in the access helpers, a restrictive policy on every table and storage object, and the self-access functions); required for platform staff (`PLATFORM_MFA`) |
| F3 | Medium | Rate limits counted per server instance, so N instances allowed N times the limit (sign-in attempts included) | Fixed: shared counters (migration 22) |
| F4 | Medium | The client IP for rate limits was the first `X-Forwarded-For` entry. Behind Cloudflare (ADR-011) that entry is client-controlled, and Vercel would see only Cloudflare's addresses | Fixed: `TRUSTED_IP_HEADER` names the one header the edge sets; no fallback to other headers |
| F5 | Medium | Signed-in pages allowed `'unsafe-inline'` scripts | Fixed: nonce-based CSP |
| F6 | Low | A damaged PDF can leave a rejected promise inside pdf.js that nothing handles. Next.js logs it, but a plain Node.js worker stops on one | Mitigated: the loading task is destroyed on failure, and a guard logs pdf.js's own error types only. The root cause inside pdf.js is not fixed |
| F7 | Low | Logs could carry questions, answers, names, IPs, or emails inside error messages | Fixed: redaction rules and email masking |
| F8 | Low | `app.academic_join_failures` had no RLS (it was already unreachable) | Fixed: RLS on, grants revoked |
| F9 | Low | HSTS `preload` before the production domains are final; the obsolete `interest-cohort` directive | Fixed: removed both |
| F10 | Info | The platform readiness card called the AI provider "planned" and the next milestone still described Phase 4 | Fixed |

## 3. Open risks and follow-ups

- **Targeted sign-in lockout:** someone who knows an email address can use up its 5 attempts per 10 minutes. This is the usual trade-off of per-account limits; Turnstile on the sign-in form reduces it.
- **Two-step sign-in, not yet live:** the Supabase MFA flow (enroll, challenge, verify, remove) is written against the documented API and unit-tested in its rules, but has never run against a real Supabase Auth. Test it before launch (TASKS.md). `PLATFORM_MFA=optional` turns the platform requirement off if needed.
- **Residual two-step coverage:** a few SECURITY DEFINER functions return only the caller's own settings by `auth.uid()` (for example notification preferences) and do not check the second step. They expose nothing about other people.
- **Platform requirement in the database:** the database requires the second step only for accounts that have a factor; the requirement that platform staff *have* one is enforced by the app.
- **Prompt-injection eval and the backup drill:** see the checklist.
