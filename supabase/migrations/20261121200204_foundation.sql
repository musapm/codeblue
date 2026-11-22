-- UniAgent AI · Phase 2 · Migration 1/5: foundation, identity and tenancy tables.
--
-- Security model: docs/tenant-isolation.md. Every table below has RLS enabled; the
-- policies live in migration 3. Tenant-owned rows carry tenant_id, and child rows
-- reference parents through composite (tenant_id, id) foreign keys so the database
-- itself refuses cross-tenant references.

-- ---------------------------------------------------------------------------
-- 0. Hardening of a Supabase-provided helper.
-- public.rls_auto_enable() backs the "auto-enable RLS" event trigger. Keep it, but it
-- must not be callable through the Data API (security advisor 0028/0029).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Private schema for security helpers. NOT listed in the Data API's exposed
--    schemas, so nothing in it is reachable over REST/RPC.
-- ---------------------------------------------------------------------------
create schema if not exists app;
comment on schema app is 'UniAgent private security helpers. Never expose through the Data API.';
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Tenant branding JSON may only contain hex colors (defense in depth behind the app's
-- theme engine; the values end up in CSS).
create or replace function app.valid_branding(b jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(b) = 'object'
    and coalesce(b ->> 'primary', '#000000') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(b ->> 'secondary', '#000000') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(b ->> 'accent', '#000000') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(char_length(b ->> 'assistant_name'), 0) <= 60
$$;

revoke all on function app.set_updated_at() from public;
revoke all on function app.valid_branding(jsonb) from public;
grant execute on function app.valid_branding(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Types
-- ---------------------------------------------------------------------------
create type public.tenant_status as enum ('trial', 'active', 'suspended', 'archived');
create type public.membership_status as enum ('invited', 'active', 'suspended');
create type public.platform_role as enum ('owner', 'admin', 'support', 'billing');

-- ---------------------------------------------------------------------------
-- 3. Tenancy
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    constraint tenants_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'),
  name text not null
    constraint tenants_name_length check (char_length(btrim(name)) between 2 and 160),
  name_translations jsonb not null default '{}'::jsonb
    constraint tenants_name_translations_object check (jsonb_typeof(name_translations) = 'object'),
  status public.tenant_status not null default 'trial',
  default_locale text not null default 'en'
    constraint tenants_default_locale check (default_locale in ('en', 'ar')),
  timezone text not null default 'UTC'
    constraint tenants_timezone_length check (char_length(timezone) between 1 and 64),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
comment on table public.tenants is 'Universities (tenants). Archived, never deleted through the API.';

-- Reject unknown time zones (a CHECK constraint cannot consult the catalog).
create or replace function app.validate_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform now() at time zone new.timezone;
  return new;
end;
$$;
revoke all on function app.validate_tenant() from public;

create trigger tenants_validate before insert or update of timezone on public.tenants
  for each row execute function app.validate_tenant();
create trigger tenants_updated_at before update on public.tenants
  for each row execute function app.set_updated_at();

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  self_signup_enabled boolean not null default false,
  allowed_email_domains text[] not null default '{}',
  support_email text
    constraint tenant_settings_support_email check (support_email is null or support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at timestamptz not null default now()
);
create trigger tenant_settings_updated_at before update on public.tenant_settings
  for each row execute function app.set_updated_at();

create table public.tenant_branding (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  published jsonb not null default '{}'::jsonb
    constraint tenant_branding_published_valid check (app.valid_branding(published)),
  draft jsonb
    constraint tenant_branding_draft_valid check (draft is null or app.valid_branding(draft)),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger tenant_branding_updated_at before update on public.tenant_branding
  for each row execute function app.set_updated_at();

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  hostname text not null unique
    constraint tenant_domains_hostname check (hostname = lower(hostname) and hostname ~ '^[a-z0-9.-]{3,253}$'),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index tenant_domains_tenant_idx on public.tenant_domains (tenant_id);

-- ---------------------------------------------------------------------------
-- 4. Catalogs (seeded in migration 2; read-only through the API)
-- ---------------------------------------------------------------------------
create table public.permissions (
  key text primary key constraint permissions_key_format check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description text not null,
  category text not null
);

create table public.features (
  key text primary key constraint features_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  description text not null,
  planned_phase smallint not null
);

-- Effective features per tenant. Phase 3/15 adds plans on top; until then every new
-- tenant gets all catalog features enabled, and enforcement uses this table.
create table public.tenant_features (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  feature_key text not null references public.features (key) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);
create trigger tenant_features_updated_at before update on public.tenant_features
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Identity
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 120),
  locale text not null default 'en' constraint profiles_locale check (locale in ('en', 'ar')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, id)
);
create index tenant_memberships_user_idx on public.tenant_memberships (user_id);
create trigger tenant_memberships_updated_at before update on public.tenant_memberships
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Roles and departments (composite FKs keep every reference inside one tenant)
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null constraint roles_key_format check (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text not null constraint roles_name_length check (char_length(btrim(name)) between 2 and 80),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.role_permissions (
  tenant_id uuid not null,
  role_id uuid not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade
);
create index role_permissions_tenant_idx on public.role_permissions (tenant_id);

create table public.membership_roles (
  tenant_id uuid not null,
  membership_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_id),
  foreign key (tenant_id, membership_id) references public.tenant_memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade
);
create index membership_roles_role_idx on public.membership_roles (role_id);
create index membership_roles_tenant_idx on public.membership_roles (tenant_id);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  slug text not null constraint departments_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'),
  name text not null constraint departments_name_length check (char_length(btrim(name)) between 2 and 120),
  name_translations jsonb not null default '{}'::jsonb
    constraint departments_name_translations_object check (jsonb_typeof(name_translations) = 'object'),
  email text constraint departments_email check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (tenant_id, id)
);

create table public.membership_departments (
  tenant_id uuid not null,
  membership_id uuid not null,
  department_id uuid not null,
  primary key (membership_id, department_id),
  foreign key (tenant_id, membership_id) references public.tenant_memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id) on delete cascade
);
create index membership_departments_department_idx on public.membership_departments (department_id);
create index membership_departments_tenant_idx on public.membership_departments (tenant_id);

-- ---------------------------------------------------------------------------
-- 7. Invitations (raw token is emailed once; only its SHA-256 hash is stored)
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null constraint invitations_email check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id uuid not null,
  token_hash text not null unique constraint invitations_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade
);
create index invitations_tenant_idx on public.invitations (tenant_id);
create index invitations_email_idx on public.invitations (email);

-- ---------------------------------------------------------------------------
-- 8. Break-glass support access: time-boxed (max 24h), reasoned, audited, read-only
-- ---------------------------------------------------------------------------
create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  grantee_id uuid not null references auth.users (id) on delete cascade,
  reason text not null constraint support_access_reason check (char_length(btrim(reason)) >= 10),
  granted_by uuid references auth.users (id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_access_window check (expires_at > starts_at and expires_at <= starts_at + interval '24 hours')
);
create index support_access_grants_lookup_idx on public.support_access_grants (grantee_id, tenant_id);

-- ---------------------------------------------------------------------------
-- 9. Append-only audit log (no FKs, so history survives deletions)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  actor_id uuid,
  actor_type text not null constraint audit_logs_actor_type check (actor_type in ('user', 'platform_admin', 'system')),
  action text not null constraint audit_logs_action check (char_length(action) between 3 and 80),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

-- ---------------------------------------------------------------------------
-- 10. Row Level Security on every table; least-privilege table grants.
--     Supabase grants ALL (incl. TRUNCATE, which ignores RLS) to anon/authenticated by
--     default. Revoke what is not needed; RLS policies then decide row access.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_settings', 'tenant_branding', 'tenant_domains', 'permissions', 'features',
    'tenant_features', 'profiles', 'platform_admins', 'tenant_memberships', 'roles', 'role_permissions',
    'membership_roles', 'departments', 'membership_departments', 'invitations', 'support_access_grants',
    'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke truncate, references, trigger on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end
$$;

-- The audit log is append-only for every API role, including service_role.
revoke insert, update, delete, truncate on table public.audit_logs from authenticated, service_role;
