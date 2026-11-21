# Deployment Strategy

> Status: **Phase 0 recommendation.** Nothing has been deployed. Production deployment requires your
> explicit approval (and paid service tiers, see §4).

## 1. Recommended MVP topology

| Layer | Recommendation | Why |
| --- | --- | --- |
| Web app (Next.js 16) | **Vercel** to start, with code kept portable | First-class support for Next.js 16 features this app relies on (Cache Components, proxy, streaming). Least operational work for a small team |
| Database, Auth, Storage | **Supabase** (dedicated UniAgent projects: `uniagent-dev`, `uniagent-staging`, `uniagent-prod`) | Postgres + RLS + pgvector + Auth + Storage in one managed service |
| DNS, TLS, WAF, bot protection | **Cloudflare** (DNS + WAF; Turnstile on public chat and forms) | Strong edge protection and abuse prevention for public AI endpoints |
| Email | Transactional provider (e.g. Resend / Postmark / SES) via SMTP in Supabase Auth + app notifications | Reliable auth and notification email |
| AI | Anthropic API (default), embedding provider TBD in Phase 4 | See `ai-architecture.md` |
| Background jobs | Postgres job queue + scheduled worker invocation (Vercel Cron, or a small Node worker) | No extra queue service in the MVP |

### Cloudflare-hosted alternative

Running the Next.js app **on Cloudflare Workers** (via the OpenNext adapter) can be cheaper at scale.
Cloudflare for SaaS also handles custom university domains well. Next.js 16 Cache Components officially
requires the Node.js runtime, so this option must pass a **compatibility spike** before we commit: build,
auth flow, streaming chat, and the proxy on Workers. The spike is scheduled right after Phase 2 (TASKS.md).
The codebase avoids Vercel-only APIs so either host works. A Docker image (`output: 'standalone'`) is also
possible for self-hosting or in-country hosting.

## 2. Environments

| Env | App | Supabase | Data |
| --- | --- | --- | --- |
| Local | `npm run dev` | `uniagent-dev` project (or the Supabase CLI local stack where Docker exists) | Demo tenant seed |
| Preview | Per-branch preview deployments | `uniagent-dev` or Supabase branching | Demo seed only |
| Staging | `staging.<domain>` | `uniagent-staging` | Demo + test tenants |
| Production | `<domain>`, tenant subdomains, custom domains | `uniagent-prod` (Pro plan, PITR backups) | Real tenants |

Secrets are set in each host's environment settings. They are never committed (see `environment-variables.md`).

## 3. Release process

1. CI on every PR: `npm run check` (typecheck, lint, unit), RLS/isolation tests, `npm run build`, and e2e smoke.
2. Migrations are applied to staging first (`supabase db push`), verified, then applied to production in a
   maintenance-safe order (expand → deploy → contract).
3. The app is promoted to production. A smoke test and `/api/health` check follow.
4. **Rollback:** redeploy the previous build (instant on Vercel). Database rollbacks use forward-fix
   migrations. PITR restore is the last resort.

## 4. Cost and account notes (verify current pricing before purchase)

- Commercial production use requires **paid tiers**. Vercel's free Hobby tier is non-commercial.
  Supabase Free pauses inactive projects and has no point-in-time recovery.
- AI usage is the main variable cost. Tenant budgets and usage limits (Phase 15/23) keep it bounded.
- Some providers (cloud, AI, payments) restrict service in certain countries. Confirm availability for
  your target markets, and any **data-residency requirements** in university contracts, before choosing
  regions. The Supabase region is fixed per project.

## 5. Domains and tenants

- Platform: `app.<domain>` (workspace and console) and `<domain>` (marketing).
- Tenant portal: `<tenant>.<domain>` by default. Custom domains like `ai.university.edu` are supported via
  `tenant_domains` + host-based routing in `proxy.ts` (Phase 3/17), with automatic TLS from the host.

## 6. Monitoring and backups (Phase 17)

Uptime checks on `/api/health`, error tracking (e.g. Sentry; no PII in events), structured logs shipped
from the host, Supabase PITR + daily logical backups of critical tables, and a documented restore drill.
