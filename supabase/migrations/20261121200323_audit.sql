-- UniAgent AI · Phase 2 · Migration 4/5: database-enforced audit trail.
--
-- Triggers (not application code) write audit rows, so every change to access, roles,
-- tenant configuration and support grants is recorded no matter which client made it.
-- Rows are append-only: no API role can update or delete them (migration 1 revokes
-- the privileges; there are no write policies).

create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Never copy secrets into the log.
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' end;
  v_actor uuid := auth.uid();
  v_tenant uuid;
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new; -- no-op update
  end if;

  v_tenant := case when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid else (v_row ->> 'tenant_id')::uuid end;

  insert into public.audit_logs (tenant_id, actor_id, actor_type, action, target_type, target_id, metadata)
  values (
    v_tenant,
    v_actor,
    case
      when v_actor is null then 'system'
      when exists (select 1 from public.platform_admins pa where pa.user_id = v_actor) then 'platform_admin'
      else 'user'
    end,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'membership_id', v_row ->> 'role_id', v_row ->> 'user_id', v_row ->> 'tenant_id'),
    jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new))
  );
  return coalesce(new, old);
end;
$$;

revoke all on function app.audit_row_change() from public;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_settings', 'tenant_branding', 'tenant_domains', 'tenant_features', 'platform_admins',
    'tenant_memberships', 'roles', 'role_permissions', 'membership_roles', 'departments',
    'membership_departments', 'invitations', 'support_access_grants'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()',
      t || '_audit', t
    );
  end loop;
end
$$;
