-- UniAgent AI · Phase 3 · Migration 6: university management.
--
-- Invitations (secure single-use tokens), member listing, platform overview, a guard
-- that keeps at least one university owner, tenant profile + branding publishing, and
-- a tenant-scoped storage bucket for logos. Every function either describes/acts for the
-- caller only or checks authorization explicitly; all writes are audited by the
-- triggers from migration 4.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Cast that never throws (storage paths are user-controlled).
create or replace function app.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Branding JSON: hex colors only, bounded texts, logo path inside the tenant's folder.
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
    and coalesce(char_length(b ->> 'assistant_name_ar'), 0) <= 60
    and coalesce(char_length(b ->> 'welcome'), 0) <= 280
    and coalesce(char_length(b ->> 'welcome_ar'), 0) <= 280
    and coalesce(char_length(b ->> 'monogram'), 0) <= 3
    and (b ->> 'logo_path' is null or b ->> 'logo_path' ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$')
$$;

-- Can the caller grant this role? Platform owners/admins (onboarding) and holders of
-- roles.manage can grant any role; members with members.invite can only grant roles whose
-- permissions are a subset of their own (no privilege escalation through invitations).
create or replace function app.can_grant_role(p_tenant uuid, p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_platform_admin(array['owner', 'admin']::public.platform_role[])
    or app.has_permission(p_tenant, 'roles.manage')
    or (
      app.has_permission(p_tenant, 'members.invite')
      and not exists (
        select rp.permission_key from public.role_permissions rp where rp.role_id = p_role
        except
        select rp2.permission_key
        from public.tenant_memberships m
        join public.membership_roles mr on mr.membership_id = m.id
        join public.role_permissions rp2 on rp2.role_id = mr.role_id
        where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
      )
    );
$$;

create or replace function app.tenant_id_for_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.tenants t where t.slug = lower(btrim(p_slug));
$$;

revoke all on function app.try_uuid(text), app.can_grant_role(uuid, uuid), app.tenant_id_for_slug(text) from public;
grant execute on function app.try_uuid(text), app.valid_branding(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog fix: department administrators also get academic.use, so that (under the
-- no-escalation rule of can_grant_role) they can invite students into their department.
-- Applied to the template and to existing system department_admin roles.
-- ---------------------------------------------------------------------------
insert into app.role_template_permissions (role_key, permission_key)
values ('department_admin', 'academic.use')
on conflict do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'academic.use'
from public.roles r
where r.key = 'department_admin' and r.is_system
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Every university keeps at least one active owner.
-- ---------------------------------------------------------------------------
create or replace function app.ensure_tenant_keeps_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := coalesce(old.tenant_id, new.tenant_id);
  v_owner_role uuid;
  v_involved boolean;
begin
  -- The tenant itself is being deleted (cascade): nothing to protect.
  if not exists (select 1 from public.tenants t where t.id = v_tenant) then
    return null;
  end if;
  select r.id into v_owner_role from public.roles r where r.tenant_id = v_tenant and r.key = 'university_owner';

  if tg_table_name = 'membership_roles' then
    v_involved := old.role_id = v_owner_role;
  else
    v_involved := exists (
      select 1 from public.membership_roles mr where mr.membership_id = old.id and mr.role_id = v_owner_role
    ) and (tg_op = 'DELETE' or new.status <> 'active');
  end if;

  if v_involved and not exists (
    select 1
    from public.tenant_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    where m.tenant_id = v_tenant and m.status = 'active' and mr.role_id = v_owner_role
  ) then
    raise exception 'a university must keep at least one active owner' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function app.ensure_tenant_keeps_owner() from public;

create trigger membership_roles_keep_owner after delete on public.membership_roles
  for each row execute function app.ensure_tenant_keeps_owner();
create trigger tenant_memberships_keep_owner after update of status or delete on public.tenant_memberships
  for each row execute function app.ensure_tenant_keeps_owner();

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

-- Creates an invitation and returns the raw token ONCE; only its SHA-256 hash is stored.
create or replace function public.create_invitation(
  p_tenant_slug text,
  p_email text,
  p_role_key text,
  p_valid_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_role uuid;
  v_email text := lower(btrim(p_email));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  select * into v_tenant from public.tenants t where t.slug = lower(btrim(p_tenant_slug));
  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  if not (app.has_permission(v_tenant.id, 'members.invite') or app.is_platform_admin(array['owner', 'admin']::public.platform_role[])) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_tenant.status not in ('trial', 'active') then
    raise exception 'tenant is not operating' using errcode = '42501';
  end if;
  if p_valid_days is null or p_valid_days not between 1 and 30 then
    raise exception 'validity must be between 1 and 30 days' using errcode = '22023';
  end if;

  select r.id into v_role from public.roles r where r.tenant_id = v_tenant.id and r.key = p_role_key;
  if v_role is null then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  if not app.can_grant_role(v_tenant.id, v_role) then
    raise exception 'not allowed to grant this role' using errcode = '42501';
  end if;

  -- A new invitation replaces any pending one for the same person.
  update public.invitations
  set revoked_at = now()
  where tenant_id = v_tenant.id and email = v_email and accepted_at is null and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(days => p_valid_days);

  insert into public.invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
  values (v_tenant.id, v_email, v_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), v_expires)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

-- What a signed-in person holding an invitation link may see before accepting.
create or replace function public.invitation_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_user_email text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into v_inv from public.invitations i where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_inv.id is null then
    return null;
  end if;
  select lower(u.email) into v_user_email from auth.users u where u.id = auth.uid();

  return jsonb_build_object(
    'tenant_name', (select t.name from public.tenants t where t.id = v_inv.tenant_id),
    'tenant_name_translations', (select t.name_translations from public.tenants t where t.id = v_inv.tenant_id),
    'role_key', (select r.key from public.roles r where r.id = v_inv.role_id),
    'role_name', (select r.name from public.roles r where r.id = v_inv.role_id),
    'status', case
      when v_inv.accepted_at is not null then 'accepted'
      when v_inv.revoked_at is not null then 'revoked'
      when v_inv.expires_at <= now() then 'expired'
      else 'pending'
    end,
    'email_matches', coalesce(v_user_email = v_inv.email, false),
    -- Masked so a forwarded link does not reveal the full address.
    'email_hint', left(v_inv.email, 1) || '***@' || split_part(v_inv.email, '@', 2),
    'expires_at', v_inv.expires_at
  );
end;
$$;

-- Accepts an invitation for the caller (whose confirmed email must match). Returns the slug.
create or replace function public.accept_invitation(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_email text;
  v_membership uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invitation' using errcode = 'P0002';
  end if;

  select * into v_inv from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  if v_inv.id is null then
    raise exception 'invalid invitation' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'invitation is no longer valid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = v_inv.tenant_id and t.status in ('trial', 'active')) then
    raise exception 'tenant is not operating' using errcode = '42501';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null or v_email <> v_inv.email then
    raise exception 'invitation belongs to a different email address' using errcode = '42501';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, status)
  values (v_inv.tenant_id, auth.uid(), 'active')
  on conflict (tenant_id, user_id) do update set status = 'active'
  returning id into v_membership;

  insert into public.membership_roles (tenant_id, membership_id, role_id)
  values (v_inv.tenant_id, v_membership, v_inv.role_id)
  on conflict do nothing;

  update public.invitations set accepted_at = now() where id = v_inv.id;

  return (select t.slug from public.tenants t where t.id = v_inv.tenant_id);
end;
$$;

-- Pending invitations of a tenant (never the token or its hash).
create or replace function public.tenant_invitations(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not (
    app.has_permission(v_tenant, 'members.invite')
    or app.has_permission(v_tenant, 'members.manage')
    or app.is_platform_admin(array['owner', 'admin']::public.platform_role[])
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'email', i.email, 'role_key', r.key, 'role_name', r.name,
      'expires_at', i.expires_at, 'created_at', i.created_at,
      'expired', i.expires_at <= now()
    ) order by i.created_at desc)
    from public.invitations i join public.roles r on r.id = i.role_id
    where i.tenant_id = v_tenant and i.accepted_at is null and i.revoked_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select i.tenant_id into v_tenant from public.invitations i where i.id = p_invitation;
  if v_tenant is null or not (
    app.has_permission(v_tenant, 'members.invite')
    or app.has_permission(v_tenant, 'members.manage')
    or app.is_platform_admin(array['owner', 'admin']::public.platform_role[])
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now()
  where id = p_invitation and accepted_at is null and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members (with email) for people holding members.read in that tenant, or a support grant.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_members(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not (app.has_permission(v_tenant, 'members.read') or app.has_support_access(v_tenant)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'membership_id', m.id,
      'user_id', m.user_id,
      'full_name', p.full_name,
      'email', u.email,
      'status', m.status,
      'joined_at', m.created_at,
      'role_keys', coalesce((
        select jsonb_agg(r.key order by r.key)
        from public.membership_roles mr join public.roles r on r.id = mr.role_id
        where mr.membership_id = m.id
      ), '[]'::jsonb),
      'department_ids', coalesce((
        select jsonb_agg(md.department_id) from public.membership_departments md where md.membership_id = m.id
      ), '[]'::jsonb)
    ) order by coalesce(p.full_name, u.email))
    from public.tenant_memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.tenant_id = v_tenant
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenant profile (display names, default language, time zone) for tenant admins.
-- The canonical name, slug and lifecycle status stay platform-managed.
-- ---------------------------------------------------------------------------
create or replace function public.update_tenant_profile(
  p_tenant_slug text,
  p_name_translations jsonb,
  p_default_locale text,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tenant.settings.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Nested checks: SQL does not guarantee short-circuit evaluation of OR.
  if p_name_translations is null or jsonb_typeof(p_name_translations) <> 'object' then
    raise exception 'invalid name translations' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(p_name_translations) e
    where e.key not in ('en', 'ar') or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 160
  ) then
    raise exception 'invalid name translations' using errcode = '22023';
  end if;
  update public.tenants
  set name_translations = p_name_translations, default_locale = p_default_locale, timezone = p_timezone
  where id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- Branding: publish the saved draft (published_by is always the caller).
-- ---------------------------------------------------------------------------
create or replace function public.publish_branding(p_tenant_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tenant.branding.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.tenant_branding
  set published = coalesce(draft, published), draft = null, published_at = now(), published_by = auth.uid()
  where tenant_id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform console: tenant overview with aggregate counts only (no personal data).
-- ---------------------------------------------------------------------------
create or replace function public.platform_tenants()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'name_translations', t.name_translations,
      'status', t.status, 'is_demo', t.is_demo, 'default_locale', t.default_locale, 'timezone', t.timezone,
      'created_at', t.created_at,
      'member_count', (select count(*) from public.tenant_memberships m where m.tenant_id = t.id and m.status = 'active'),
      'pending_invitations', (select count(*) from public.invitations i where i.tenant_id = t.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
      'features_enabled', (select count(*) from public.tenant_features f where f.tenant_id = t.id and f.enabled)
    ) order by t.created_at desc)
    from public.tenants t
  ), '[]'::jsonb);
end;
$$;

-- Platform staff directory (for support-access grants): platform owners/admins only.
create or replace function public.platform_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin(array['owner', 'admin']::public.platform_role[]) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', pa.user_id, 'role', pa.role, 'email', u.email, 'full_name', p.full_name) order by u.email)
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
    left join public.profiles p on p.id = pa.user_id
  ), '[]'::jsonb);
end;
$$;

-- RPC exposure: signed-in users only; each function authorizes internally.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_invitation(text, text, text, integer)',
    'public.invitation_preview(text)',
    'public.accept_invitation(text)',
    'public.tenant_invitations(text)',
    'public.revoke_invitation(uuid)',
    'public.tenant_members(text)',
    'public.update_tenant_profile(text, jsonb, text, text)',
    'public.publish_branding(text)',
    'public.platform_tenants()',
    'public.platform_staff()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Storage: public bucket for tenant brand assets (logos). Anyone may READ a logo by its
-- public URL; only branding managers of that tenant may write inside "<tenant_id>/".
-- SVG is not allowed (it can carry scripts).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-assets', 'tenant-assets', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy tenant_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-assets' and app.has_permission(app.try_uuid((storage.foldername(name))[1]), 'tenant.branding.manage'));
create policy tenant_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-assets' and app.has_permission(app.try_uuid((storage.foldername(name))[1]), 'tenant.branding.manage'));
create policy tenant_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-assets' and app.has_permission(app.try_uuid((storage.foldername(name))[1]), 'tenant.branding.manage'))
  with check (bucket_id = 'tenant-assets' and app.has_permission(app.try_uuid((storage.foldername(name))[1]), 'tenant.branding.manage'));
create policy tenant_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-assets' and app.has_permission(app.try_uuid((storage.foldername(name))[1]), 'tenant.branding.manage'));
