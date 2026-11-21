# UniAgent AI — System Architecture

> Status: **Phase 0 design**. Sections marked _(planned)_ describe components scheduled for
> later phases. See `docs/roadmap.md` for when each is built.

## 1. Product summary

UniAgent AI is a **multi-tenant SaaS platform**. Each university (a _tenant_) gets what feels like
its own dedicated AI platform: its own branding, users, roles, departments, knowledge base, AI
agents, tickets, admissions leads, analytics, and integrations. One platform owner (Super Admin)
operates all tenants from a central console.

Design goals, in priority order:

1. **Tenant isolation**: no data crosses tenant boundaries, enforced in the database.
2. **Trustworthy AI**: answers grounded in the tenant's official sources, with citations. No
   invented fees, dates, or policies. Clear escalation when information is missing.
3. **Least privilege**: every action is authorized server-side against roles, permissions,
   departments, and feature entitlements.
4. **Commercial control**: plans, feature toggles, usage limits, and AI cost visibility per tenant.
5. **Simplicity**: one deployable web app plus managed services. No microservices until needed.

## 2. High-level architecture

```
                ┌──────────────────────────────────────────────────────────────┐
  Browser ─────▶│  Edge: DNS · TLS · WAF · bot protection (Cloudflare)         │
  (student,     └──────────────────────────────┬───────────────────────────────┘
   applicant,                                  │
   staff, admin)                               ▼
                ┌──────────────────────────────────────────────────────────────┐
                │  Next.js 16 application (Node.js runtime)                    │
                │                                                              │
                │  proxy.ts ── locale routing · session refresh · coarse gate  │
                │                                                              │
                │  UI layer (React Server + Client Components)                 │
                │   ├─ Marketing site            /[lang]/…                     │
                │   ├─ Auth                      /[lang]/login …               │
                │   ├─ Tenant workspace          /[lang]/app/[tenant]/…        │
                │   ├─ Platform console          /[lang]/platform/…            │
                │   └─ Tenant public portal      /[lang]/u/[tenant] (planned)  │
                │                                                              │
                │  Server layer (Server Actions · Route Handlers)              │
                │   └─ Data Access Layer (DAL): the only code that touches data │
                │        ├─ auth/session   ├─ tenants   ├─ permissions         │
                │        ├─ knowledge      ├─ tickets   ├─ leads (planned)     │
                │        └─ AI orchestrator ─▶ providers · tools · retrieval    │
                └───────────────┬──────────────────────────────┬───────────────┘
                                │ user-scoped JWT               │ background jobs
                                ▼ (RLS enforced)                ▼ (service role, audited)
                ┌──────────────────────────────┐   ┌─────────────────────────────┐
                │ Supabase                     │   │ Job worker (planned)         │
                │  ├─ Auth (users, sessions)   │   │  ingestion · embeddings ·    │
                │  ├─ Postgres + RLS + pgvector│◀──│  notifications · analytics   │
                │  └─ Storage (private buckets)│   │  rollups                     │
                └──────────────────────────────┘   └──────────────┬──────────────┘
                                                                  ▼
                                               ┌────────────────────────────────┐
                                               │ AI providers (abstracted)      │
                                               │  LLM: Anthropic Claude (default)│
                                               │  Embeddings: pluggable          │
                                               │  Speech: pluggable (Phase 13)   │
                                               └────────────────────────────────┘
```

### Why this shape

- **A single Next.js app** keeps the system easy to deploy and reason about. Server Actions and
  Route Handlers are the API surface, and the browser never talks to the database with privileged keys.
- **Supabase** provides Postgres, Auth, and Storage together. RLS policies use the same identity
  (`auth.uid()`) that Supabase Auth issues, so isolation is enforced by the database itself.
- **Defense in depth.** The proxy does a coarse check ("is there a session?"). The DAL authorizes
  ("is this user a member of this tenant with permission X?"). RLS enforces it again at the row level.
  Any one layer failing does not expose data.

## 3. Request flow (authenticated tenant workspace)

1. `proxy.ts` ensures a locale prefix and refreshes the Supabase session cookie. If `/app` or
   `/platform` is requested with no session, it redirects to login. This check is **optimistic only**.
2. The page or Server Action calls the DAL. For example, `requireTenantContext(slug)` resolves the user
   (`auth.getUser()`), loads the tenant by slug **through RLS** (a non-member gets "not found", which
   prevents tenant enumeration), and loads the member's roles, permissions, departments, and the
   tenant's effective features.
3. The DAL checks the required permission or feature, then queries with the **user's JWT**, so RLS applies.
4. Sensitive mutations write an `audit_logs` row in the same transaction (a DB function).
5. The response returns only the fields the UI needs (DTOs), never raw rows.

## 4. Module structure (source tree)

```
src/
  app/                         Routes (thin; delegate to lib/)
    [lang]/                    Root layout: <html lang dir>, fonts, locale = root param
      (marketing)/             Public website
      (auth)/                  Login, register, password reset
      app/[tenant]/…           Tenant workspace (dashboard shell)
      platform/…               Platform owner console
    auth/callback|confirm/     Supabase auth code / OTP exchange (route handlers)
    api/health/                Health check
    global-not-found.tsx       404 for unmatched URLs
    global-error.tsx           Last-resort error boundary
  proxy.ts                     Locale routing + session refresh + coarse auth gate
  components/
    ui/                        Design-system primitives (Button, Input, Card, …)
    marketing/ auth/ app-shell/ branding/   Feature components
  content/marketing/           Typed marketing copy (en, ar)
  lib/
    env/                       Validated environment (server-only vs public)
    i18n/                      Locales, direction, dictionaries, negotiation
    branding/                  Platform branding + tenant theme engine
    auth/                      Session DAL, schemas, server actions, preview mode
    supabase/                  SSR clients (server, browser, proxy)
    navigation/                Role- and feature-aware navigation model
    permissions/ features/     Permission and feature catalogs (shared with DB seeds)
    logger.ts errors.ts rate-limit.ts safe-redirect.ts
supabase/                      (Phase 2) migrations, seed, RLS tests
e2e/                           Playwright end-to-end tests
docs/                          Architecture and operations documentation
```

**Rule:** route files stay thin. Business logic lives in `src/lib/**` modules that are
`server-only` where they touch secrets or data, so it is reusable by actions, route handlers,
background jobs, and AI tools.

## 5. Key cross-cutting concerns

| Concern | Approach | Doc |
| --- | --- | --- |
| Tenant isolation | `tenant_id` on every tenant row, RLS, composite FKs, membership-checked DAL | `tenant-isolation.md` |
| Authentication | Supabase Auth (email/password, magic link later, SSO later) with SSR cookies | `authentication.md` |
| Authorization | Permission-based RBAC + department scoping + feature entitlements | `authorization.md` |
| AI | Orchestrator with provider abstraction, strict tool schemas, citation validation, budgets | `ai-architecture.md` |
| Knowledge | Ingestion pipeline → chunks + embeddings → hybrid retrieval with permission filtering | `knowledge-retrieval.md` |
| Branding | Platform defaults (config) + per-tenant themes (validated colors → CSS variables) | this doc §6 |
| i18n | `/[lang]` routing (en, ar), RTL via `dir`, typed dictionaries | this doc §7 |
| Security | Headers/CSP, validation (zod), rate limits, audit logs, secrets in env only | `security.md` |
| Observability | Structured JSON logs with redaction, request IDs, AI usage events | `security.md` §8 |

## 6. Branding and white-labeling

- **Platform branding** (name, tagline, colors, support email) comes from `src/lib/branding/platform.ts`,
  which reads `NEXT_PUBLIC_PLATFORM_*` variables with safe defaults. No UI file hardcodes the product
  name, and a unit test enforces this. In Phase 3 the values move to a `platform_settings` table, with
  env as the bootstrap fallback. Internal identifiers (the `UNIAGENT_` env-var prefix, the
  `uniagent-web` log service name, the npm package name) are a stable codename. They are never shown
  to users and do not need to change if the product is renamed.
- **Tenant branding** (logo, primary/secondary/accent colors, assistant name and avatar, welcome
  message per locale, contact info, footer) is stored per tenant with **draft** and **published**
  versions (Phase 3). The UI previews the draft before publishing.
- **Theme engine** (`src/lib/branding/theme.ts`): colors are validated as strict hex. Invalid input
  falls back to the default, which prevents CSS injection. The engine derives hover, subtle, and
  foreground colors, checks WCAG contrast, and emits CSS custom properties scoped to the tenant
  container. Tailwind tokens (`bg-primary`, `text-primary-foreground`, …) read those variables, so one
  codebase renders any tenant's theme.
- **Custom domains** _(planned, Phase 3/17)_: `tenant_domains` maps hostnames such as `ai.university.edu`
  to tenants. The proxy rewrites by host to the tenant portal. Authorization never trusts the hostname alone.

## 7. Internationalization

- Locales: `en` (LTR) and `ar` (RTL). URLs are prefixed (`/en/...`, `/ar/...`). The proxy redirects
  un-prefixed URLs using the `NEXT_LOCALE` cookie, then `Accept-Language`, then the default.
- The root layout reads the locale via `next/root-params`, so `<html lang dir>` is correct and pages
  stay statically prerendered.
- UI strings live in typed dictionaries (`src/lib/i18n/dictionaries/{en,ar}.ts`). TypeScript makes
  a missing Arabic key a compile error, and a unit test double-checks parity.
- Layout uses CSS logical properties (`ms-*`, `pe-*`, `start-*`) so RTL mirrors correctly.
- The AI assistant (Phase 5) answers in the user's language, including mixed Arabic/English and
  dialects. The UI locale and the conversation language are independent.

## 8. Background processing _(planned, Phase 4+)_

Long-running work (document extraction, embeddings, notification fan-out, analytics rollups) runs
outside request handlers. It uses a **Postgres-backed job queue** (`jobs` table, `FOR UPDATE SKIP LOCKED`)
processed by a worker entry point (`src/lib/jobs/worker.ts`). The worker can be invoked by a scheduler
(Vercel Cron / Cloudflare Cron Triggers / a long-running Node process). This keeps the system portable
across hosts without adding a separate queue service in the MVP.

## 9. What is intentionally **not** in the MVP

- Microservices, Kubernetes, or a separate API server.
- A payment gateway. Billing is manual first (Phase 15).
- Real SIS/LMS write integrations. The integration framework and status come first; real connectors
  need credentials (Phase 14).
- Voice. It is a modular feature in Phase 13.
- Fine-tuning or training on student data.
