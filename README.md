# UniAgent AI

Multi-tenant AI agent platform for universities. Each university gets its own branded environment
(users, knowledge, AI agents, tickets, analytics), and the platform owner manages all of them centrally.

> **Status:** Foundation only. See the [implementation audit](docs/IMPLEMENTATION_AUDIT.md) for what really works.
> The dedicated Supabase project ("agent") has no tables yet, authentication is only partially verified,
> and there is no AI yet. See [`PROJECT_STATUS.md`](PROJECT_STATUS.md).
> The product name is configurable (`NEXT_PUBLIC_PLATFORM_NAME`); "UniAgent AI" is a working title.

## Quick start

Requirements: Node.js ≥ 22.12, npm.

```bash
npm install
cp .env.example .env.local      # optional; works without any values
npm run dev                     # http://localhost:3000  (redirects to /en or /ar)
```

To see the workspace shell before authentication exists, set `UNIAGENT_UI_PREVIEW=true` in
`.env.local` and open `/en/app`. Preview mode only works while Supabase is **not** configured, and it
shows a permanent banner. It uses fictional universities, and nothing is saved.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run check` | Typecheck + lint + unit tests |
| `npm run test:e2e` | Playwright end-to-end tests (after `npm run build`) |

## Tech stack

Next.js 16 (App Router, Cache Components, `proxy.ts`) · React 19 · TypeScript · Tailwind CSS v4 ·
Radix primitives · Supabase (Postgres + RLS + Auth + Storage, from Phase 2) · zod · Vitest ·
Playwright + axe. AI: provider abstraction with Anthropic Claude as the default (Phase 5).

## Project structure

```
src/app/[lang]/(marketing)   Public website (en/ar)
src/app/[lang]/(auth)        Login, register, password reset
src/app/[lang]/app/[tenant]  University workspace (dashboard shell)
src/app/[lang]/platform      Platform owner console
src/app/auth/*               Supabase auth callbacks
src/proxy.ts                 Locale routing, session refresh, coarse auth gate
src/lib/                     Domain and infrastructure modules (env, auth, i18n, branding, tenancy, …)
src/components/              UI system and feature components
src/content/marketing/       Typed marketing copy (en, ar)
e2e/                         Playwright tests
docs/                        Architecture, security, operations
```

## Documentation

| Topic | Document |
| --- | --- |
| Current status, known issues, next steps | [PROJECT_STATUS.md](PROJECT_STATUS.md) |
| Task checklist | [TASKS.md](TASKS.md) |
| Architecture decisions (ADRs) | [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) |
| Repository inspection (Phase 0) | [docs/00-repository-inspection.md](docs/00-repository-inspection.md) |
| **Implementation audit (current real state)** | [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md) |
| System architecture | [docs/architecture.md](docs/architecture.md) |
| Database schema | [docs/database-schema.md](docs/database-schema.md) |
| Tenant isolation | [docs/tenant-isolation.md](docs/tenant-isolation.md) |
| Authentication / Authorization | [docs/authentication.md](docs/authentication.md) · [docs/authorization.md](docs/authorization.md) |
| AI architecture / Knowledge retrieval | [docs/ai-architecture.md](docs/ai-architecture.md) · [docs/knowledge-retrieval.md](docs/knowledge-retrieval.md) |
| Security plan | [docs/security.md](docs/security.md) |
| Deployment / Environment variables | [docs/deployment.md](docs/deployment.md) · [docs/environment-variables.md](docs/environment-variables.md) |
| API reference | [docs/api.md](docs/api.md) |
| Testing / Troubleshooting | [docs/testing.md](docs/testing.md) · [docs/troubleshooting.md](docs/troubleshooting.md) |
| Roadmap / Progress log | [docs/roadmap.md](docs/roadmap.md) · [docs/progress-log.md](docs/progress-log.md) |

## Security

Never commit secrets. `.env*` files are git-ignored. Report vulnerabilities privately to the platform owner.
