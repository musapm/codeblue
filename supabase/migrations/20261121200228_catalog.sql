-- UniAgent AI · Phase 2 · Migration 2/5: permission, feature and role-template catalogs.
--
-- Keep in sync with src/lib/permissions/catalog.ts and src/lib/features/catalog.ts
-- (a unit test compares them). Keys must never be renamed without a migration.

insert into public.permissions (key, description, category) values
  ('tenant.settings.read', 'View university settings', 'tenant'),
  ('tenant.settings.manage', 'Manage university settings', 'tenant'),
  ('tenant.branding.manage', 'Manage branding', 'tenant'),
  ('tenant.features.read', 'View enabled features', 'tenant'),
  ('members.read', 'View members', 'members'),
  ('members.invite', 'Invite members', 'members'),
  ('members.manage', 'Manage members', 'members'),
  ('roles.manage', 'Manage roles and permissions', 'members'),
  ('departments.manage', 'Manage departments', 'members'),
  ('knowledge.read_public', 'Read public knowledge', 'knowledge'),
  ('knowledge.read_internal', 'Read internal knowledge', 'knowledge'),
  ('knowledge.manage', 'Upload and manage knowledge sources', 'knowledge'),
  ('knowledge.publish', 'Publish knowledge sources', 'knowledge'),
  ('assistant.use', 'Use the student assistant', 'assistant'),
  ('assistant.staff.use', 'Use the staff assistant', 'assistant'),
  ('assistant.configure', 'Configure AI agents', 'assistant'),
  ('tickets.create', 'Create tickets', 'tickets'),
  ('tickets.read_own', 'View own tickets', 'tickets'),
  ('tickets.read_department', 'View department tickets', 'tickets'),
  ('tickets.read_all', 'View all tickets', 'tickets'),
  ('tickets.update', 'Update tickets', 'tickets'),
  ('tickets.assign', 'Assign tickets', 'tickets'),
  ('tickets.notes.read', 'Read internal ticket notes', 'tickets'),
  ('tickets.notes.write', 'Write internal ticket notes', 'tickets'),
  ('leads.read', 'View admissions leads', 'admissions'),
  ('leads.manage', 'Manage admissions leads', 'admissions'),
  ('programs.manage', 'Manage programs', 'admissions'),
  ('academic.use', 'Use academic tools', 'academic'),
  ('academic.manage', 'Manage academic content', 'academic'),
  ('campus.manage', 'Manage campus locations', 'campus'),
  ('analytics.view', 'View analytics', 'analytics'),
  ('analytics.ai_costs.view', 'View AI usage and costs', 'analytics'),
  ('quality.review', 'Review AI quality', 'quality'),
  ('integrations.manage', 'Manage integrations', 'integrations'),
  ('audit.read', 'Read audit logs', 'audit');

insert into public.features (key, description, planned_phase) values
  ('knowledge_base', 'University knowledge base', 4),
  ('student_assistant', 'Student assistant', 5),
  ('admissions_agent', 'Admissions agent', 6),
  ('ticketing', 'Ticketing and human handoff', 7),
  ('analytics_basic', 'Basic analytics', 8),
  ('analytics_advanced', 'Advanced analytics', 8),
  ('academic_agent', 'Academic assistant', 9),
  ('staff_assistant', 'Staff assistant', 10),
  ('workflow_agent', 'Requests and workflows', 11),
  ('campus_assistant', 'Campus assistant', 12),
  ('voice', 'Voice', 13),
  ('integrations', 'Integrations', 14),
  ('whatsapp', 'WhatsApp channel', 14),
  ('sso', 'Single sign-on', 16),
  ('custom_domain', 'Custom domain', 17);

-- ---------------------------------------------------------------------------
-- System role templates (docs/authorization.md §3), copied into every new tenant by
-- public.create_tenant(). Private schema: not reachable through the API.
-- ---------------------------------------------------------------------------
create table app.role_templates (
  key text primary key,
  name text not null,
  description text not null,
  sort_order smallint not null
);

create table app.role_template_permissions (
  role_key text not null references app.role_templates (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

alter table app.role_templates enable row level security;
alter table app.role_template_permissions enable row level security;
revoke all on table app.role_templates, app.role_template_permissions from public, anon, authenticated;

insert into app.role_templates (key, name, description, sort_order) values
  ('university_owner', 'University owner', 'Full control of the university workspace', 1),
  ('university_admin', 'University administrator', 'Administers the university workspace', 2),
  ('department_admin', 'Department administrator', 'Leads a department: members, knowledge and tickets', 3),
  ('admissions_staff', 'Admissions staff', 'Admissions inquiries, leads and programs', 4),
  ('registrar', 'Registrar', 'Registration requests and records support', 5),
  ('student_affairs', 'Student affairs', 'Student services and support', 6),
  ('finance_staff', 'Finance staff', 'Financial inquiries and workflows', 7),
  ('it_support', 'IT support', 'Technical support tickets', 8),
  ('academic_affairs', 'Academic affairs', 'Academic content and course materials', 9),
  ('library_staff', 'Library staff', 'Library services and support', 10),
  ('hr_staff', 'HR staff', 'Human resources inquiries', 11),
  ('quality_reviewer', 'AI quality reviewer', 'Reviews flagged AI answers and knowledge gaps', 12),
  ('student', 'Student', 'Uses the assistant and creates tickets', 13);

-- Owners and administrators: every permission.
insert into app.role_template_permissions (role_key, permission_key)
select r.key, p.key
from (values ('university_owner'), ('university_admin')) as r (key)
cross join public.permissions p;

-- Shared staff baseline.
with staff_base (permission_key) as (
  values ('tenant.settings.read'), ('tenant.features.read'), ('knowledge.read_public'), ('knowledge.read_internal'),
         ('assistant.use'), ('assistant.staff.use'), ('tickets.create'), ('tickets.read_own'),
         ('tickets.read_department'), ('tickets.update'), ('tickets.notes.read'), ('tickets.notes.write')
)
insert into app.role_template_permissions (role_key, permission_key)
select r.key, s.permission_key
from (values ('admissions_staff'), ('registrar'), ('student_affairs'), ('finance_staff'), ('it_support'),
             ('academic_affairs'), ('library_staff'), ('hr_staff')) as r (key)
cross join staff_base s;

insert into app.role_template_permissions (role_key, permission_key) values
  ('admissions_staff', 'leads.read'),
  ('admissions_staff', 'leads.manage'),
  ('admissions_staff', 'programs.manage'),
  ('academic_affairs', 'academic.use'),
  ('academic_affairs', 'academic.manage'),
  ('department_admin', 'tenant.settings.read'),
  ('department_admin', 'tenant.features.read'),
  ('department_admin', 'members.read'),
  ('department_admin', 'members.invite'),
  ('department_admin', 'knowledge.read_public'),
  ('department_admin', 'knowledge.read_internal'),
  ('department_admin', 'knowledge.manage'),
  ('department_admin', 'assistant.use'),
  ('department_admin', 'assistant.staff.use'),
  ('department_admin', 'tickets.create'),
  ('department_admin', 'tickets.read_own'),
  ('department_admin', 'tickets.read_department'),
  ('department_admin', 'tickets.update'),
  ('department_admin', 'tickets.assign'),
  ('department_admin', 'tickets.notes.read'),
  ('department_admin', 'tickets.notes.write'),
  ('department_admin', 'analytics.view'),
  ('quality_reviewer', 'tenant.settings.read'),
  ('quality_reviewer', 'knowledge.read_public'),
  ('quality_reviewer', 'knowledge.read_internal'),
  ('quality_reviewer', 'quality.review'),
  ('quality_reviewer', 'analytics.view'),
  ('student', 'assistant.use'),
  ('student', 'tickets.create'),
  ('student', 'tickets.read_own'),
  ('student', 'knowledge.read_public'),
  ('student', 'academic.use');
