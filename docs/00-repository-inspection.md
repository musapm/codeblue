# Phase 0 — Repository & Environment Inspection Report

_Date: 2026-11-21_

## 1. Repository state

| Item | Finding |
| --- | --- |
| Repository | `musapm/codeblue` |
| Commits | 1 (`48d637c Initial commit`) |
| Files | `README.md` (10 bytes: `# codeblue`) |
| Existing application code | **None** |
| Existing database / migrations | **None** |
| Existing CI / deployment config | **None** |

**Conclusion:** this is a new project. No existing work had to be preserved or migrated.
The original one-line README was replaced with project documentation.

> **Naming note.** The repository is called `codeblue`, and the connected Supabase account
> already has a project named `codeblue- clinicalsimulator`. Both appear to belong to a
> different product (Code Blue). UniAgent AI does **not** use that Supabase project, and
> no code depends on the repository name. You can rename the repository later (for
> example to `uniagent-ai`) without code changes.

## 2. Development environment

| Tool | Version / status |
| --- | --- |
| Node.js | 22.23 |
| npm / pnpm / yarn / bun | 10.9 / 10.28 / 1.22 / 1.4 (npm is used) |
| PostgreSQL server binaries | 16.15 (available locally, used for RLS tests from Phase 2) |
| pgvector extension | Not installed locally (needed in Phase 4) |
| Docker daemon | Not running (so the Supabase local stack is not available here) |
| Chromium + Playwright | Pre-installed (Playwright 1.63) — used for end-to-end tests |
| Network | npm registry and Google Fonts reachable |

## 3. External accounts detected

| Service | Status |
| --- | --- |
| Supabase (via connector) | Account connected, with 2 existing projects for **other products**. These were not modified. UniAgent AI needs **its own new project** (Phase 2). |
| GitHub | Repository access limited to `musapm/codeblue`. |
| AI provider keys | None configured (needed in Phase 5). |

## 4. Framework findings that shaped the plan

The latest Next.js is **16.4**. It differs from older versions in ways that affect the architecture:

- **`proxy.ts` replaces `middleware.ts`** (it runs on the Node.js runtime by default).
- **Cache Components is on by default.** Reading cookies or headers outside a `<Suspense>`
  boundary is a build error. Authenticated areas must stream behind Suspense or opt out
  of instant-navigation validation (`export const instant = false`).
- **`next/root-params`** lets an `app/[lang]` root layout set `<html lang dir>` while
  pages stay statically prerendered. This is what makes proper Arabic (RTL) support cheap.
- **Error boundaries receive `retry()`**, not `reset()`, as the primary recovery function.
- **Nonce-based CSP requires dynamic rendering**, so a static marketing site uses header-based CSP.

## 5. Risks identified during inspection

1. No Supabase project exists for UniAgent yet, so Phase 2 (the tenant-security gate) needs one.
2. Docker is unavailable here, so RLS tests run on a local PostgreSQL 16 with a
   Supabase-compatible `auth` shim. They should also run against a real Supabase project.
3. pgvector is not installed locally, so Phase 4 needs it installed or a Supabase branch.
4. Next.js 16 Cache Components is new. Hosting adapters (for example Cloudflare via OpenNext)
   must be validated early. See `docs/deployment.md`.
