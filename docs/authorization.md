# Authorization (RBAC, departments, features)

Authorization answers: **may this user perform this action on this resource in this tenant?**
Every check happens **on the server**. Hiding a button is a UX nicety, never a control.

## 1. Model

```
user ──< tenant_membership >── tenant
            │
            ├──< membership_roles >── role ──< role_permissions >── permission (catalog)
            └──< membership_departments >── department

tenant ── subscription ── plan ──< plan_features >── feature (catalog)
       └─ feature overrides
```

A request is allowed when **all** of these hold:

1. The user has an **active membership** in the tenant (or holds a platform role for a platform action).
2. The tenant is **active or trial**. Suspended or archived tenants are read-blocked for members.
3. One of the user's roles grants the **permission**.
4. For department-scoped permissions, the resource's department is one of the user's **departments**.
5. The tenant's plan and overrides enable the **feature** the action belongs to.
6. The resource-level rules hold. For example, students may read only their own tickets, and a
   document's visibility must allow the user's audience.

Checks 1–4 and 6 are enforced **in RLS** (`app.has_permission`, `app.in_department`). Check 5 is
enforced in the DAL and in RLS for feature-specific tables. The DAL repeats checks to give friendly
errors, while RLS guarantees correctness.

## 2. Permission catalog (initial)

Permission keys follow `resource.action[_scope]`. The canonical list is
`src/lib/permissions/catalog.ts`, which is also used to seed the `permissions` table.

| Category | Permissions |
| --- | --- |
| Tenant | `tenant.settings.read`, `tenant.settings.manage`, `tenant.branding.manage`, `tenant.features.read` |
| Members | `members.read`, `members.invite`, `members.manage`, `roles.manage`, `departments.manage` |
| Knowledge | `knowledge.read_public`, `knowledge.read_internal`, `knowledge.manage`, `knowledge.publish` |
| Assistant | `assistant.use`, `assistant.staff.use`, `assistant.configure` |
| Tickets | `tickets.create`, `tickets.read_own`, `tickets.read_department`, `tickets.read_all`, `tickets.update`, `tickets.assign`, `tickets.notes.read`, `tickets.notes.write` |
| Admissions | `leads.read`, `leads.manage`, `programs.manage` |
| Academic | `academic.use`, `academic.manage` |
| Campus | `campus.manage` |
| Analytics | `analytics.view`, `analytics.ai_costs.view` |
| Quality | `quality.review` |
| Integrations | `integrations.manage` |
| Audit | `audit.read` |

## 3. System role templates (copied into every new tenant)

| Role | Summary of grants |
| --- | --- |
| `university_owner` | Everything in the tenant, including role management and integrations |
| `university_admin` | Everything except owner transfer |
| `department_admin` | Members of own department(s); tickets/knowledge in own department(s) |
| `admissions_staff` | `leads.*`, `programs.manage`, tickets & knowledge (department-scoped) |
| `registrar` | Registration tickets/workflows, internal registration knowledge |
| `student_affairs` | Student-affairs tickets and knowledge |
| `finance_staff` | Finance tickets and workflows (no access to unrelated student records) |
| `it_support` | Technical tickets, technical knowledge |
| `academic_affairs` | Academic knowledge, `academic.manage` (create courses, assign instructors, academic AI budget) |
| `faculty` | Faculty member (Phase 9): staff baseline + `academic.use`; teaches the courses they are assigned to (course-level instructor role) |
| `library_staff`, `hr_staff` | Their department's tickets and knowledge |
| `quality_reviewer` | `quality.review`, read access to flagged conversations (no PII export) |
| `student` | `assistant.use`, `tickets.create`, `tickets.read_own`, `knowledge.read_public`, `academic.use` |

Tenant admins can create **custom roles** from the catalog. Permission keys cannot be invented outside it.

## 4. Platform roles

| Role | Scope |
| --- | --- |
| `owner` | Everything on the platform: tenants, plans, features, global AI config, platform settings |
| `admin` | Tenant lifecycle and configuration (not ownership transfer) |
| `support` | Tenant metadata and health. Tenant content only through a time-boxed, audited `support_access_grant` |
| `billing` | Plans, subscriptions, payment records, usage reports (owners and admins can do the same; Phase 15) |

**No platform role, including `owner`, can read university content** (members, profiles, roles,
departments, invitations, and later tickets, documents and conversations) without an active,
time-boxed support grant. This is enforced by RLS and covered by isolation tests T11, T11b, T12 and T13 (ADR-014).

## 5. Features (entitlements)

Feature keys (`src/lib/features/catalog.ts`): `student_assistant`, `admissions_agent`,
`academic_agent`, `staff_assistant`, `workflow_agent`, `campus_assistant`, `voice`, `ticketing`,
`knowledge_base`, `analytics_basic`, `analytics_advanced`, `integrations`, `whatsapp`, `custom_domain`,
`sso`.

## 6. AI-specific authorization

- The AI orchestrator receives a **request context** (tenant, user, permissions, departments, features)
  built by the DAL. It cannot widen this context.
- Each tool declares the permission and feature it needs. The tool executor checks them **before**
  running, and the underlying queries still run under the user's JWT, so RLS applies.
- Consequential tools (submit a request, send an email) return a **draft that requires user
  confirmation**. They never complete an official action on their own.
- If a user asks about another person's data, retrieval and tools return nothing, and the assistant
  says it cannot share that information.

## Course-level roles (Phase 9)

Inside a course, `course_members.role` is `instructor` or `student`. It does not replace the tenant permissions; it narrows them:
- **Teach a course** (materials, study tools, enrollment, class figures): `academic.manage` in the university, or `instructor` in that course together with `academic.use`.
- **Study in a course** (published materials, study tools when on): `student` in that course, with `academic.use`, while the course is active.
- Course materials are readable only through these rules, never through knowledge-base permissions (ADR-029).

## Staff assistant (Phase 10)

- **Use it** (questions, drafts, ticket digest): `assistant.staff.use` with the `staff_assistant` feature, while the university has switched it on. The ticket digest also needs `ticketing` and `tickets.read_department` or `tickets.read_all`; the "all departments" view needs `tickets.read_all`.
- **Configure it** (switch, guidance, budget, daily limit, usage): `assistant.configure` with the feature.
- **What it can read** is never more than the person can read: retrieval runs with their own session (the department filter only narrows it), and the digest takes only tickets they work, never their own requests (ADR-030).
- **Drafts** are readable only by their author.

## Service request workflows (Phase 11)

All of it needs the `workflow_agent` feature, and it reuses the ticket permissions (ADR-031):
- **Submit and follow requests:** `tickets.create`, `tickets.read_own`.
- **Process requests:** `tickets.update` with `tickets.read_department` in the form's department, or `tickets.read_all` (also the general queue); the assignee always. Nobody processes their own request.
- **Internal notes:** `tickets.notes.read` / `tickets.notes.write`. **Assign colleagues:** `tickets.assign`.
- **Manage forms:** `departments.manage`. **Form suggestions (AI) settings:** `assistant.configure`.

## Campus (Phase 12)

All of it needs the `campus_assistant` feature:
- **See the directory, map and location pages, and ask campus questions:** any member (published locations only).
- **Manage locations** (create, edit, publish, delete; see unpublished ones): `campus.manage` (owners and administrators by default).
- **Campus answers (AI) settings:** `assistant.configure`.

## Voice (Phase 13)

- **Use voice in a chat:** the `voice` feature, the university's switch, and the chat's own permission (`assistant.use` for the student chat, `assistant.staff.use` for the staff chat).
- **Voice settings and usage figures:** `assistant.configure`.
- **Usage rows** are not readable by anyone directly; only aggregates are shown.

## Notifications and integrations (Phase 14)

- **Notification settings:** each member, for themselves only (with the ticketing or workflow feature).
- **Integrations and the email outbox counts:** `integrations.manage` and the `integrations` feature.
- **The outbox rows** are not readable by anyone directly; secrets are never stored, only their names.

## Plans and subscriptions (Phase 15)

- **Plans, subscriptions, payments, the usage report and the renewal check:** platform `owner`, `admin` or `billing` (not `support`).
- **A university's own plan, status, limits and use:** `tenant.settings.read`; its payments: `tenant.settings.manage`.
- **Limits** are enforced by the database for everyone, including platform staff acting through the app.
