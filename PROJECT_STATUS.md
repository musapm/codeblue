# Project Status

_Last updated: 2026-11-21_

## Summary

| Phase | Status |
| --- | --- |
| 0: Discovery, architecture, planning | ✅ Complete |
| 1: Foundation & design system | ✅ Complete |
| 2: Auth, tenants & security foundation | ⏭ Next (critical gate). Needs a dedicated Supabase project |
| 3–17 | Not started (see `docs/roadmap.md`) |

## What exists now

### Fully implemented and tested
- **Project foundation:** Next.js 16.4, TypeScript strict, Tailwind v4, ESLint, Vitest, Playwright + axe.
- **Design system:** tokens, theming via CSS variables, and accessible components.
- **Theme engine:** tenant colors are validated as hex (CSS-injection safe), with derived shades and a WCAG contrast assessment.
- **White-label branding:** the product name, emails, and colors come from configuration. A test blocks hardcoded product names.
- **Bilingual UI:** English and Arabic with full RTL, locale-prefixed URLs, Accept-Language and cookie negotiation, a language switcher, and a dictionary-parity test.
- **Public website (en + ar):** Home, Product, Features, Solutions, Pricing (no hardcoded prices), Demo (live two-university theme switch), About, Contact, Privacy, Terms. It has no fake testimonials, logos, or statistics.
- **Security baseline:** security headers and CSP, open-redirect guard, input validation, redacting logger, safe error messages, rate limiting (in-memory), `server-only` boundaries.
- **Workspace and platform console shells:** navigation model with permission and feature keys, workspace switcher, user menu, mobile drawer, settings (general + branding live preview), environment-readiness panel, and honest "Planned · Phase N" placeholders.
- **Error handling:** localized 404, global 404, segment and global error boundaries with reference IDs, health endpoint.

### Partially implemented
- **Authentication:** login, register, forgot, and reset pages; Server Actions; Supabase SSR clients; callback/confirm routes; and the proxy session refresh are all written, typed, and unit-tested at the schema level. They are **not tested against a live Supabase project** (none exists for UniAgent yet). Until then the pages show "Authentication is not configured" with inputs disabled.
- **Contact / demo request form:** validates and requires consent, but **does not store or send** anything yet. It says so and offers a pre-filled email link instead.
- **Rate limiting:** in-memory per server instance. It must move to a shared store before production.

### Mocked / preview only
- **UI preview mode** (`UNIAGENT_UI_PREVIEW=true`) shows the workspace with fictional tenants ("Northbridge University", "Al-Noor Institute of Technology") and a fictional admin. It only works when no auth backend is configured, and it displays a permanent banner.
- The chat previews on the website and in the branding editor are **static illustrations**, clearly labelled. There is no AI yet.

### Not implemented (by design, later phases)
Database, tenants, roles and RLS (Phase 2) · tenant management (3) · knowledge ingestion (4) · AI chat (5) ·
admissions (6) · tickets (7) · analytics (8) · academic (9) · staff agent (10) · workflows (11) · campus (12) ·
voice (13) · notifications and integrations (14) · subscriptions (15).

### Requires external credentials or accounts
- Supabase project (Phase 2), transactional email provider (Phase 2), AI provider key (Phase 5),
  embedding provider (Phase 4), hosting account and domain (Phase 17).

## Test results (2026-11-21)

| Check | Result |
| --- | --- |
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass (0 problems) |
| `npm test` (Vitest) | ✅ 81 / 81 passed |
| `npm run build` | ✅ pass (69 static pages; marketing pages fully static) |
| `npm run test:e2e` (Playwright, desktop + mobile) | ✅ 56 / 56 passed, including axe WCAG A/AA checks (no serious or critical violations) on key pages |

## Known issues and limitations

1. **HTTP status in `/app` and `/platform`:** redirects and 404s are streamed after the static shell, so the status is 200 while the content is never rendered. Once Supabase is configured, the proxy adds a real 307 for unauthenticated requests. See `docs/testing.md`.
2. **CSP** allows `'unsafe-inline'` scripts (required for statically prerendered pages). Nonce-based CSP for app routes is planned (ADR-013).
3. **Privacy Policy and Terms** are clearly marked draft templates and need legal review.
4. **Default support and sales emails** are `example.com` placeholders until configured.
5. **No CI workflow** yet. The checks run locally.
6. The repository is named `codeblue`, which differs from the product. Renaming it is optional and needs no code changes.

## Security considerations
- No secrets exist in the repository. `.env*` is ignored, with only `.env.example` committed.
- Auth email links use the configured site URL, never the `Host` header.
- Preview mode cannot coexist with a configured auth backend (unit-tested).
- Tenant isolation is designed (`docs/tenant-isolation.md`) but **not yet enforced in a database**. No real tenant data may be onboarded before the Phase 2 gate passes.

## Decisions needed from the product owner

1. **Supabase project for UniAgent:** your account has two projects for other products. Should I create a new `uniagent-dev` project (Free tier is enough for development) through the connected Supabase account, or will you create it and share the URL and publishable key?
2. **Data region:** where should production data live? This depends on your target universities' requirements, and it cannot change after project creation.

## Next steps

Phase 2: create the Supabase dev project, write the identity/tenancy migrations with RLS, build the
isolation test harness and pass tests T1–T15 and T18, replace the preview-only tenant context with
membership-checked lookups, and test live auth end to end. Then run the hosting spike (Vercel vs Cloudflare).
