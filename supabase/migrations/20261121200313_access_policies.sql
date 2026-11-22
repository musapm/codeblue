-- UniAgent AI · Phase 2 · Migration 3/5: access helpers and Row Level Security policies.
--
-- Helpers are SECURITY DEFINER (they read membership tables without triggering RLS
-- recursion), STABLE, pinned to an empty search_path, and live in the private `app`
-- schema, so they are usable inside policies but not callable over the Data API.
-- They only ever answer questions about the *calling* user (auth.uid()).

-- Is the caller platform staff (optionally with one of the given roles)?
create or replace function app.is_platform_admin(p_roles public.platform_role[] default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
      and (p_roles is null or pa.role = any (p_roles))
  );
$$;

-- Active membership, regardless of the tenant's lifecycle status (lets the app tell a
-- member that their university is suspended instead of pretending it does not exist).
create or replace function app.has_membership(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- Active membership in an operating (trial/active) tenant. Suspension blocks data access.
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
  );
$$;

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
  );
$$;

create or replace function app.in_department(p_tenant uuid, p_department uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.membership_departments md
    join public.tenant_memberships m on m.id = md.membership_id
    where md.tenant_id = p_tenant and md.department_id = p_department
      and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- Platform staff may read a tenant's data only during an active, unrevoked grant.
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
  );
$$;

create or replace function app.tenant_has_feature(p_tenant uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_features tf
    where tf.tenant_id = p_tenant and tf.feature_key = p_feature and tf.enabled
  );
$$;

-- Profiles are personal data. Visible to: the person themself; members holding
-- members.read in a tenant the person belongs to; platform staff with an active support
-- grant for such a tenant; and platform staff viewing other platform staff.
-- Platform roles alone do NOT reveal university members (master prompt: administrative
-- access to tenant data must go through an explicit, audited mechanism).
create or replace function app.can_view_profile(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user = auth.uid()
    or (app.is_platform_admin() and exists (select 1 from public.platform_admins pa where pa.user_id = p_user))
    or exists (
      select 1
      from public.tenant_memberships target
      where target.user_id = p_user
        and (app.has_permission(target.tenant_id, 'members.read') or app.has_support_access(target.tenant_id))
    );
$$;

-- True for direct database sessions (migrations, seeds, SQL editor) and service_role
-- requests; false for any request made with an end-user or anon JWT.
create or replace function app.is_trusted_backend()
returns boolean
language sql stable set search_path = ''
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then true
    else (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
  end;
$$;

revoke all on all functions in schema app from public;
grant execute on function
  app.is_platform_admin(public.platform_role[]),
  app.has_membership(uuid),
  app.is_tenant_member(uuid),
  app.has_permission(uuid, text),
  app.in_department(uuid, uuid),
  app.has_support_access(uuid),
  app.tenant_has_feature(uuid, text),
  app.can_view_profile(uuid),
  app.valid_branding(jsonb)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies. Every policy targets `authenticated` explicitly; `anon` has no table
-- privileges at all (revoked in migration 1). No DELETE policy means no deletes.
-- ---------------------------------------------------------------------------

-- tenants: members, platform staff, and support grantees can read; only platform
-- owners/admins can create or change (status changes included).
create policy tenants_select on public.tenants for select to authenticated
  using (app.has_membership(id) or app.is_platform_admin() or app.has_support_access(id));
create policy tenants_insert on public.tenants for insert to authenticated
  with check (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));
create policy tenants_update on public.tenants for update to authenticated
  using (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]))
  with check (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));

-- tenant_settings
create policy tenant_settings_select on public.tenant_settings for select to authenticated
  using (app.is_tenant_member(tenant_id) or app.is_platform_admin() or app.has_support_access(tenant_id));
create policy tenant_settings_insert on public.tenant_settings for insert to authenticated
  with check (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));
create policy tenant_settings_update on public.tenant_settings for update to authenticated
  using (app.has_permission(tenant_id, 'tenant.settings.manage') or app.is_platform_admin(array['owner', 'admin']::public.platform_role[]))
  with check (app.has_permission(tenant_id, 'tenant.settings.manage') or app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));

-- tenant_branding
create policy tenant_branding_select on public.tenant_branding for select to authenticated
  using (app.is_tenant_member(tenant_id) or app.is_platform_admin() or app.has_support_access(tenant_id));
create policy tenant_branding_insert on public.tenant_branding for insert to authenticated
  with check (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));
create policy tenant_branding_update on public.tenant_branding for update to authenticated
  using (app.has_permission(tenant_id, 'tenant.branding.manage') or app.is_platform_admin(array['owner', 'admin']::public.platform_role[]))
  with check (app.has_permission(tenant_id, 'tenant.branding.manage') or app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));

-- tenant_domains: platform-managed
create policy tenant_domains_select on public.tenant_domains for select to authenticated
  using (app.is_tenant_member(tenant_id) or app.is_platform_admin() or app.has_support_access(tenant_id));
create policy tenant_domains_write on public.tenant_domains for all to authenticated
  using (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]))
  with check (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));

-- catalogs: readable by any signed-in user, never writable through the API
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy features_select on public.features for select to authenticated using (true);

-- tenant_features: platform-managed entitlements
create policy tenant_features_select on public.tenant_features for select to authenticated
  using (app.is_tenant_member(tenant_id) or app.is_platform_admin() or app.has_support_access(tenant_id));
create policy tenant_features_write on public.tenant_features for all to authenticated
  using (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]))
  with check (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));

-- profiles: created by trigger; editable only by their owner
create policy profiles_select on public.profiles for select to authenticated
  using (app.can_view_profile(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- platform_admins: only platform owners can grant or revoke platform roles
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or app.is_platform_admin());
create policy platform_admins_write on public.platform_admins for all to authenticated
  using (app.is_platform_admin(array['owner']::public.platform_role[]))
  with check (app.is_platform_admin(array['owner']::public.platform_role[]));

-- tenant_memberships
-- Platform staff get no blanket access to university members: onboarding goes through
-- audited SECURITY DEFINER functions (create_tenant), troubleshooting through grants.
create policy tenant_memberships_select on public.tenant_memberships for select to authenticated
  using (
    user_id = auth.uid()
    or app.has_permission(tenant_id, 'members.read')
    or app.has_support_access(tenant_id)
  );
create policy tenant_memberships_write on public.tenant_memberships for all to authenticated
  using (app.has_permission(tenant_id, 'members.manage'))
  with check (app.has_permission(tenant_id, 'members.manage'));

-- roles: system roles are immutable through the API
create policy roles_select on public.roles for select to authenticated
  using (app.is_tenant_member(tenant_id) or app.has_support_access(tenant_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (not is_system and app.has_permission(tenant_id, 'roles.manage'));
create policy roles_update on public.roles for update to authenticated
  using (not is_system and app.has_permission(tenant_id, 'roles.manage'))
  with check (not is_system and app.has_permission(tenant_id, 'roles.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (not is_system and app.has_permission(tenant_id, 'roles.manage'));

-- role_permissions: only custom roles can be edited
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (app.is_tenant_member(tenant_id) or app.has_support_access(tenant_id));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (
    app.has_permission(tenant_id, 'roles.manage')
    and exists (select 1 from public.roles r where r.id = role_id and not r.is_system)
  );
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (
    app.has_permission(tenant_id, 'roles.manage')
    and exists (select 1 from public.roles r where r.id = role_id and not r.is_system)
  );

-- membership_roles: assigning roles requires roles.manage (members.manage alone is not enough)
create policy membership_roles_select on public.membership_roles for select to authenticated
  using (
    exists (select 1 from public.tenant_memberships m where m.id = membership_id and m.user_id = auth.uid())
    or app.has_permission(tenant_id, 'members.read')
    or app.has_support_access(tenant_id)
  );
create policy membership_roles_insert on public.membership_roles for insert to authenticated
  with check (app.has_permission(tenant_id, 'roles.manage'));
create policy membership_roles_delete on public.membership_roles for delete to authenticated
  using (app.has_permission(tenant_id, 'roles.manage'));

-- departments
create policy departments_select on public.departments for select to authenticated
  using (app.is_tenant_member(tenant_id) or app.has_support_access(tenant_id));
create policy departments_write on public.departments for all to authenticated
  using (app.has_permission(tenant_id, 'departments.manage'))
  with check (app.has_permission(tenant_id, 'departments.manage'));

-- membership_departments
create policy membership_departments_select on public.membership_departments for select to authenticated
  using (
    exists (select 1 from public.tenant_memberships m where m.id = membership_id and m.user_id = auth.uid())
    or app.has_permission(tenant_id, 'members.read')
    or app.has_support_access(tenant_id)
  );
create policy membership_departments_write on public.membership_departments for all to authenticated
  using (app.has_permission(tenant_id, 'members.manage'))
  with check (app.has_permission(tenant_id, 'members.manage'));

-- invitations: hashes visible only to people who manage invitations
create policy invitations_select on public.invitations for select to authenticated
  using (app.has_permission(tenant_id, 'members.invite') or app.has_permission(tenant_id, 'members.manage'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (app.has_permission(tenant_id, 'members.invite') and invited_by = auth.uid());
create policy invitations_update on public.invitations for update to authenticated
  using (app.has_permission(tenant_id, 'members.invite') or app.has_permission(tenant_id, 'members.manage'))
  with check (app.has_permission(tenant_id, 'members.invite') or app.has_permission(tenant_id, 'members.manage'));

-- support_access_grants: issued by platform owners/admins to platform staff only;
-- tenants with audit.read can see who was granted access to them.
create policy support_access_select on public.support_access_grants for select to authenticated
  using (grantee_id = auth.uid() or app.is_platform_admin() or app.has_permission(tenant_id, 'audit.read'));
create policy support_access_insert on public.support_access_grants for insert to authenticated
  with check (
    app.is_platform_admin(array['owner', 'admin']::public.platform_role[])
    and granted_by = auth.uid()
    and exists (select 1 from public.platform_admins pa where pa.user_id = grantee_id)
  );
create policy support_access_update on public.support_access_grants for update to authenticated
  using (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]))
  with check (app.is_platform_admin(array['owner', 'admin']::public.platform_role[]));

-- audit_logs: read-only; rows are written by SECURITY DEFINER triggers only
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (
    app.is_platform_admin(array['owner', 'admin']::public.platform_role[])
    or (tenant_id is not null and app.has_permission(tenant_id, 'audit.read'))
  );
