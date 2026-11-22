-- One-time bootstrap of the first platform owner (Super Admin).
--
-- There is deliberately NO way to become platform owner through the app or the API: the
-- first owner is created by the project owner directly in the database, and every later
-- platform role is granted by an existing owner (audited in public.audit_logs).
--
-- Steps:
--   1. Sign up in the app with your own email address and confirm it.
--   2. Replace the email below, then run this in the Supabase SQL editor.

insert into public.platform_admins (user_id, role)
select u.id, 'owner'
from auth.users u
where u.email = lower('REPLACE-WITH-YOUR-EMAIL@example.com')
on conflict (user_id) do update set role = 'owner';

-- Optional: give yourself the owner role in the demo university so you can explore it.
do $$
declare
  v_user uuid := (select id from auth.users where email = lower('REPLACE-WITH-YOUR-EMAIL@example.com'));
  v_tenant uuid := (select id from public.tenants where slug = 'northbridge');
  v_membership uuid;
begin
  if v_user is null or v_tenant is null then
    raise notice 'User or demo tenant not found; skipping demo membership.';
    return;
  end if;
  insert into public.tenant_memberships (tenant_id, user_id, status)
  values (v_tenant, v_user, 'active')
  on conflict (tenant_id, user_id) do update set status = 'active'
  returning id into v_membership;
  insert into public.membership_roles (tenant_id, membership_id, role_id)
  select v_tenant, v_membership, r.id from public.roles r where r.tenant_id = v_tenant and r.key = 'university_owner'
  on conflict do nothing;
end
$$;

-- Check:
select u.email, pa.role from public.platform_admins pa join auth.users u on u.id = pa.user_id;
