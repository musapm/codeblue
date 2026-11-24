-- UniAgent AI · Phase 16 · Migration 23: two-step sign-in (TOTP) enforced by the database.
--
-- Supabase Auth issues a first-step session (aal1) after the password and a second-step session
-- (aal2) after a code from an authenticator app. Checking this only in the app would leave the
-- database API open to a first-step session of an account that has set up two-step sign-in. So:
-- * app.mfa_ok(): true when the session is aal2, or when the person has no verified factor;
-- * the core access helpers (memberships, permissions, platform roles, support grants) require
--   it, which covers every policy and SECURITY DEFINER function built on them;
-- * a restrictive policy on every public table requires it as well, which covers the policies
--   that only compare auth.uid() (one's own profile, conversations, preferences...).
-- People without two-step sign-in are unaffected. Platform staff are required to set it up by the
-- app (ADR-036).

create or replace function app.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified');
$$;
revoke all on function app.mfa_ok() from public;
grant execute on function app.mfa_ok() to authenticated, service_role;

-- app.is_platform_admin: as in 20261121200313_access_policies.sql, plus app.mfa_ok().
create or replace function app.is_platform_admin(p_roles public.platform_role[] default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
      and (p_roles is null or pa.role = any (p_roles))
  )
    and app.mfa_ok();
$$;

-- app.has_membership: as in 20261121200313_access_policies.sql, plus app.mfa_ok().
create or replace function app.has_membership(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
  )
    and app.mfa_ok();
$$;

-- app.is_tenant_member: as in 20261121200313_access_policies.sql, plus app.mfa_ok().
create or replace function app.is_tenant_member(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
      and t.status in ('trial', 'active')
  )
    and app.mfa_ok();
$$;

-- app.has_permission: as in 20261121200313_access_policies.sql, plus app.mfa_ok().
create or replace function app.has_permission(p_tenant uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id and t.status in ('trial', 'active')
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
      and rp.permission_key = p_permission
  )
    and app.mfa_ok();
$$;

-- app.has_support_access: as in 20261121200313_access_policies.sql, plus app.mfa_ok().
create or replace function app.has_support_access(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.support_access_grants g
    join public.platform_admins pa on pa.user_id = g.grantee_id
    where g.tenant_id = p_tenant and g.grantee_id = auth.uid() and g.revoked_at is null
      and now() >= g.starts_at and now() < g.expires_at
  )
    and app.mfa_ok();
$$;

-- app.has_role_permission: as in 20261124280000_subscriptions.sql, plus app.mfa_ok().
create or replace function app.has_role_permission(p_tenant uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and rp.permission_key = p_permission
  )
    and app.mfa_ok();
$$;

-- The caller's own access (as in 20261121200345_auth_hooks_and_rpc.sql), also behind the second step.
create or replace function public.my_platform_role()
returns public.platform_role
language sql
stable
security definer
set search_path = ''
as $$
  select pa.role from public.platform_admins pa where pa.user_id = auth.uid() and app.mfa_ok();
$$;

create or replace function public.my_workspaces()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slug', t.slug,
        'name', t.name,
        'name_translations', t.name_translations,
        'status', t.status,
        'default_locale', t.default_locale,
        'timezone', t.timezone,
        'is_demo', t.is_demo,
        'branding', coalesce(b.published, '{}'::jsonb)
      )
      order by t.name
    ),
    '[]'::jsonb
  )
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  left join public.tenant_branding b on b.tenant_id = t.id
  where m.user_id = auth.uid() and m.status = 'active' and t.status <> 'archived' and app.mfa_ok();
$$;

create or replace function public.my_tenant_access(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_membership uuid;
  v_operating boolean;
begin
  if not app.mfa_ok() then
    return null; -- first step only, on an account with two-step sign-in (migration 23)
  end if;
  select * into v_tenant from public.tenants t where t.slug = lower(btrim(p_slug));
  if v_tenant.id is null then
    return null;
  end if;

  select m.id into v_membership
  from public.tenant_memberships m
  where m.tenant_id = v_tenant.id and m.user_id = auth.uid() and m.status = 'active';

  if v_membership is null and not app.has_support_access(v_tenant.id) then
    return null;
  end if;

  v_operating := v_tenant.status in ('trial', 'active');

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'slug', v_tenant.slug,
      'name', v_tenant.name,
      'name_translations', v_tenant.name_translations,
      'status', v_tenant.status,
      'default_locale', v_tenant.default_locale,
      'timezone', v_tenant.timezone,
      'is_demo', v_tenant.is_demo
    ),
    'branding', coalesce((select b.published from public.tenant_branding b where b.tenant_id = v_tenant.id), '{}'::jsonb),
    'access_via', case when v_membership is not null then 'membership' else 'support' end,
    'roles', coalesce((
      select jsonb_agg(r.key order by r.key)
      from public.membership_roles mr join public.roles r on r.id = mr.role_id
      where mr.membership_id = v_membership
    ), '[]'::jsonb),
    'permissions', case when not v_operating or v_membership is null then '[]'::jsonb else coalesce((
      select jsonb_agg(distinct rp.permission_key)
      from public.membership_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
      where mr.membership_id = v_membership
    ), '[]'::jsonb) end,
    'department_ids', coalesce((
      select jsonb_agg(md.department_id)
      from public.membership_departments md
      where md.membership_id = v_membership
    ), '[]'::jsonb),
    'features', case when not v_operating then '[]'::jsonb else coalesce((
      select jsonb_agg(tf.feature_key order by tf.feature_key)
      from public.tenant_features tf
      where tf.tenant_id = v_tenant.id and tf.enabled
    ), '[]'::jsonb) end
  );
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select app.mfa_ok())) with check ((select app.mfa_ok()))', t);
  end loop;
end
$$;

-- Storage objects (tenant documents, logos) follow the same rule.
create policy mfa_required on storage.objects as restrictive for all to authenticated using ((select app.mfa_ok())) with check ((select app.mfa_ok()));
