-- UniAgent AI · Phase 2 · Migration 5/5: profile creation hook and API functions.
--
-- Public functions are reachable over RPC, so each one either answers questions about
-- the *calling* user only, or checks authorization explicitly before doing anything.

-- ---------------------------------------------------------------------------
-- Profile row for every new auth user.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, locale)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), ''),
    case when new.raw_user_meta_data ->> 'locale' = 'ar' then 'ar' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app.handle_new_user() from public;
-- Supabase Auth inserts users as supabase_auth_admin.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema app to supabase_auth_admin;
    grant execute on function app.handle_new_user() to supabase_auth_admin;
  end if;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- create_tenant: platform owners/admins (or trusted backend sessions) only.
-- Creates the tenant with settings, branding, all catalog features, the system roles
-- and, optionally, the first owner membership. Every insert is audited by triggers.
-- ---------------------------------------------------------------------------
create or replace function public.create_tenant(
  p_slug text,
  p_name text,
  p_owner uuid default null,
  p_default_locale text default 'en',
  p_timezone text default 'UTC',
  p_is_demo boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_membership uuid;
begin
  if not (app.is_trusted_backend() or app.is_platform_admin(array['owner', 'admin']::public.platform_role[])) then
    raise exception 'not authorized to create tenants' using errcode = '42501';
  end if;

  insert into public.tenants (slug, name, default_locale, timezone, is_demo)
  values (lower(btrim(p_slug)), btrim(p_name), p_default_locale, p_timezone, p_is_demo)
  returning id into v_tenant;

  insert into public.tenant_settings (tenant_id) values (v_tenant);
  insert into public.tenant_branding (tenant_id) values (v_tenant);
  insert into public.tenant_features (tenant_id, feature_key) select v_tenant, f.key from public.features f;

  insert into public.roles (tenant_id, key, name, description, is_system)
  select v_tenant, rt.key, rt.name, rt.description, true from app.role_templates rt order by rt.sort_order;

  insert into public.role_permissions (tenant_id, role_id, permission_key)
  select v_tenant, r.id, rtp.permission_key
  from public.roles r
  join app.role_template_permissions rtp on rtp.role_key = r.key
  where r.tenant_id = v_tenant;

  if p_owner is not null then
    insert into public.tenant_memberships (tenant_id, user_id, status)
    values (v_tenant, p_owner, 'active')
    returning id into v_membership;

    insert into public.membership_roles (tenant_id, membership_id, role_id)
    select v_tenant, v_membership, r.id from public.roles r
    where r.tenant_id = v_tenant and r.key = 'university_owner';
  end if;

  return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- my_platform_role: the caller's platform role, or null.
-- ---------------------------------------------------------------------------
create or replace function public.my_platform_role()
returns public.platform_role
language sql
stable
security definer
set search_path = ''
as $$
  select pa.role from public.platform_admins pa where pa.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- my_workspaces: tenants where the caller has an active membership.
-- ---------------------------------------------------------------------------
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
  where m.user_id = auth.uid() and m.status = 'active' and t.status <> 'archived';
$$;

-- ---------------------------------------------------------------------------
-- my_tenant_access: everything the app needs to authorize the caller inside one
-- tenant (by slug). Returns null when the caller has neither an active membership nor
-- an active support grant — the app then answers "not found" (no enumeration).
-- Permissions are empty while the tenant is suspended/archived.
-- ---------------------------------------------------------------------------
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

-- RPC exposure: signed-in users only (each function authorizes internally).
revoke all on function public.create_tenant(text, text, uuid, text, text, boolean) from public, anon;
revoke all on function public.my_platform_role() from public, anon;
revoke all on function public.my_workspaces() from public, anon;
revoke all on function public.my_tenant_access(text) from public, anon;
grant execute on function public.create_tenant(text, text, uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.my_platform_role() to authenticated, service_role;
grant execute on function public.my_workspaces() to authenticated, service_role;
grant execute on function public.my_tenant_access(text) to authenticated, service_role;
