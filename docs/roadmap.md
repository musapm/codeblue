# Phase Roadmap

Complexity: **S** (days) · **M** (1–2 weeks) · **L** (2–4 weeks) · **XL** (4+ weeks), for one
full-time engineer working with AI assistance. These are planning estimates, not commitments.

Every phase must satisfy the common acceptance criteria: features implemented · DB changes documented ·
UI and backend work · permissions enforced server-side · tests run and passing · build green · known
issues documented · PROJECT_STATUS.md updated · app runnable.

| # | Phase | Complexity | Depends on | Key acceptance criteria (in addition to the common ones) |
| --- | --- | --- | --- | --- |
| 0 | Discovery, architecture, planning | S | — | All planning docs exist and are consistent |
| 1 | Foundation & design system | M | 0 | Public site (en/ar), auth pages, dashboard and console shells, theme engine, security headers; unit + e2e tests green |
| 2 | Auth, tenants, security foundation | **L (critical gate)** | 1, Supabase project | Live auth; schema + RLS for identity/tenancy; DAL tenant context; audit logs; **isolation tests T1–T15, T18 pass** |
| — | Deployment spike (Cloudflare/OpenNext vs Vercel) | S | 2 | Decision recorded in ADR |
| 3 | Super Admin & university management | L | 2 | Tenant CRUD/lifecycle, onboarding wizard, plan assignment, feature toggles enforced server-side, branding draft → publish, support access grants |
| 4 | Knowledge base & ingestion | L | 2–3 | Upload → extract → chunk → embed → search; versioning; deletion removes chunks; isolation T16–T17; embedding benchmark ADR |
| 5 | Student assistant & RAG | XL | 4 | Streaming chat, history, citations from the provider, confidence/handoff, feedback, usage + cost events, budgets, AI eval suite passing (Arabic/English/mixed, injection, cross-tenant) |
| 6 | Admissions agent & leads | L | 5 | Programs DB, public assistant (anonymous + Turnstile), consented lead capture, lead pipeline, admissions analytics |
| 7 | Ticketing & human handoff | L | 2, 5 | AI-assisted ticket drafts, routing rules, staff queues, internal-note privacy tests, notifications |
| 8 | Admin dashboard & analytics | M | 5–7 | Metrics from stored events only; knowledge-gap report; tenant-scoped; no fabricated numbers |
| 9 | Academic agent | L | 4–5 | Quizzes/flashcards/study plans with labelling of AI-generated content; per-course enablement |
| 10 | Staff agent | M | 4–5, 7 | Department-scoped internal search, drafting tools, ticket summaries; permission tests |
| 11 | Workflow agents | L | 7 | Versioned workflow definitions, confirmation step, tracking numbers, status updates |
| 12 | Campus map & assistant | M | 2 | Locations admin, search, simple map, hours and accessibility |
| 13 | Voice | M | 5 | STT/TTS behind provider interface, feature toggle, separate usage tracking, provider/cost evaluation |
| 14 | Notifications & integrations | L | 7 | In-app + email notifications with preferences; integration framework (status, logs, vault secrets); real connectors only with credentials |
| 15 | Subscriptions & commercial | M | 3 | Plans, trials, renewals, suspension, limits, manual payments, usage reports |
| 16 | Security, QA, production readiness | L | all | Checklist in `security.md` §7 complete; critical findings fixed |
| 17 | Demo, deployment & launch | M | 16 | Demo tenant + reset, production deploy, monitoring, backups, demo script |

## Recommended implementation order

`0 → 1 → 2 (gate) → spike → 3 → 4 → 5 → 7 → 6 → 8 → 15 → 12 → 10 → 11 → 9 → 14 → 13 → 16 → 17`

Rationale: tenant security first. Then the knowledge engine and student assistant, which carry the most
sales value. Ticketing before admissions, because handoff underpins every agent. Analytics once real
events exist, then commercial controls before pilots. Voice comes last because it is optional and has
the highest cost uncertainty. Phase 15's plan and limit enforcement may be pulled forward if a paid pilot
starts early.

**Pilot-ready milestone:** Phases 0–8 + 15 (core). That is enough to run a paid pilot with one university.
