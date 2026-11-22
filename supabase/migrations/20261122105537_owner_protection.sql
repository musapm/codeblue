-- UniAgent AI · Phase 3 · Migration 7: owner protection.
--
-- University administrators hold every permission (including roles.manage and
-- members.manage), which would let them grant themselves the owner role or suspend an
-- owner. Ownership changes are therefore reserved to current owners of that university
-- and to platform owners/admins. SECURITY DEFINER functions that already authorize the
-- caller (create_tenant, accept_invitation) and backend/SQL sessions are not affected:
-- the guard only applies to direct API writes (current_user = authenticated).

-- Is the caller an active owner of this tenant?
create or replace function app.is_tenant_owner(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and r.key = 'university_owner'
  );
$$;

create or replace function app.is_owner_role(p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.roles r where r.id = p_role and r.key = 'university_owner');
$$;

create or replace function app.membership_is_owner(p_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membership_roles mr join public.roles r on r.id = mr.role_id
    where mr.membership_id = p_membership and r.key = 'university_owner'
  );
$$;

revoke all on function app.is_tenant_owner(uuid), app.is_owner_role(uuid), app.membership_is_owner(uuid) from public;
grant execute on function app.is_tenant_owner(uuid), app.is_owner_role(uuid), app.membership_is_owner(uuid) to authenticated, service_role;

-- Invitations into the owner role: owners of that university or platform owners/admins.
create or replace function app.can_grant_role(p_tenant uuid, p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.is_owner_role(p_role) then
      app.is_platform_admin(array['owner', 'admin']::public.platform_role[]) or app.is_tenant_owner(p_tenant)
    else
      app.is_platform_admin(array['owner', 'admin']::public.platform_role[])
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
      )
  end;
$$;

-- SECURITY INVOKER on purpose: current_user tells direct API writes (authenticated)
-- apart from trusted definer functions and backend sessions.
create or replace function app.guard_owner_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
  v_touches_owner boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'membership_roles' then
    v_touches_owner := app.is_owner_role(coalesce(new.role_id, old.role_id));
  else
    -- tenant_memberships: status changes and removals of an owner's membership.
    v_touches_owner := app.membership_is_owner(old.id)
      and (tg_op = 'DELETE' or new.status is distinct from old.status);
  end if;

  if v_touches_owner
    and not app.is_tenant_owner(v_tenant)
    and not app.is_platform_admin(array['owner', 'admin']::public.platform_role[]) then
    raise exception 'only university owners can change ownership' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function app.guard_owner_changes() from public;
grant execute on function app.guard_owner_changes() to authenticated;

create trigger membership_roles_guard_owner before insert or delete on public.membership_roles
  for each row execute function app.guard_owner_changes();
create trigger tenant_memberships_guard_owner before update or delete on public.tenant_memberships
  for each row execute function app.guard_owner_changes();
