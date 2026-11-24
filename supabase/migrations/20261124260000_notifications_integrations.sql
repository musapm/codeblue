-- UniAgent AI · Phase 14 · Migration 20: notification preferences, the email outbox, and the
-- integration framework.
--
-- * Each member chooses, per kind of notification, in-app (default on) and email (default off).
--   app.notify and app.notify_request now follow these choices.
-- * Email: a notification that should go by email is queued in outbound_messages with a
--   reference to its ticket or request only (no text). A sender renders and sends it later; no
--   email provider is connected yet, so messages stay queued (the admin page says so).
-- * Integrations (integrations.manage, feature 'integrations'): one record per connection with a
--   kind from a fixed catalog, non-secret settings, a status, and a log. Secrets are never stored
--   in these tables: only the NAME of a secret kept in the server's secret store (secret_ref).
--   No connector runs yet: each needs the university's credentials.

-- ---------------------------------------------------------------------------
-- Notification preferences
-- ---------------------------------------------------------------------------

create table public.notification_preferences (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null constraint notification_preferences_kind check (kind in (
    'ticket_new', 'ticket_assigned', 'ticket_reply', 'ticket_status',
    'request_new', 'request_assigned', 'request_comment', 'request_status'
  )),
  in_app boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, kind)
);

create table public.outbound_messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null default 'email' constraint outbound_messages_channel check (channel = 'email'),
  kind text not null,
  ticket_id uuid,
  request_id uuid,
  status text not null default 'queued' constraint outbound_messages_status check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 constraint outbound_messages_attempts check (attempts between 0 and 10),
  last_error text constraint outbound_messages_error check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint outbound_messages_target check (num_nonnulls(ticket_id, request_id) = 1),
  foreign key (tenant_id, ticket_id) references public.tickets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, request_id) references public.workflow_requests (tenant_id, id) on delete cascade
);
create index outbound_messages_queue_idx on public.outbound_messages (status, created_at) where status = 'queued';
create index outbound_messages_tenant_idx on public.outbound_messages (tenant_id, created_at desc);

alter table public.notification_preferences enable row level security;
alter table public.outbound_messages enable row level security;
revoke all on table public.notification_preferences, public.outbound_messages from anon, authenticated;
grant select on table public.notification_preferences to authenticated;
-- The outbox is read and written by the sender (service role) and summarized for admins only.
create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (user_id = auth.uid() and app.is_tenant_member(tenant_id));

-- Who gets what: in-app unless muted; email when chosen.
create or replace function app.notify_wants(p_tenant uuid, p_user uuid, p_kind text, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_channel when 'email' then p.email else p.in_app end
    from public.notification_preferences p
    where p.tenant_id = p_tenant and p.user_id = p_user and p.kind = p_kind
  ), p_channel = 'in_app');
$$;

create or replace function app.notify(p_tenant uuid, p_users uuid[], p_kind text, p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
begin
  for u in select distinct x from unnest(p_users) as x where x is not null and x is distinct from auth.uid() loop
    if app.notify_wants(p_tenant, u, p_kind, 'in_app') then
      insert into public.notifications (tenant_id, user_id, kind, ticket_id) values (p_tenant, u, p_kind, p_ticket);
    end if;
    if app.notify_wants(p_tenant, u, p_kind, 'email') then
      insert into public.outbound_messages (tenant_id, user_id, kind, ticket_id) values (p_tenant, u, p_kind, p_ticket);
    end if;
  end loop;
end;
$$;

create or replace function app.notify_request(p_tenant uuid, p_users uuid[], p_kind text, p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
begin
  for u in select distinct x from unnest(p_users) as x where x is not null and x is distinct from auth.uid() loop
    if app.notify_wants(p_tenant, u, p_kind, 'in_app') then
      insert into public.notifications (tenant_id, user_id, kind, request_id) values (p_tenant, u, p_kind, p_request);
    end if;
    if app.notify_wants(p_tenant, u, p_kind, 'email') then
      insert into public.outbound_messages (tenant_id, user_id, kind, request_id) values (p_tenant, u, p_kind, p_request);
    end if;
  end loop;
end;
$$;

revoke all on function app.notify_wants(uuid, uuid, text, text), app.notify(uuid, uuid[], text, uuid), app.notify_request(uuid, uuid[], text, uuid) from public;

-- One's own choices, for every kind (defaults filled in).
create or replace function public.my_notification_preferences(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (
    select jsonb_agg(jsonb_build_object('kind', k, 'in_app', app.notify_wants(v_tenant, auth.uid(), k, 'in_app'), 'email', app.notify_wants(v_tenant, auth.uid(), k, 'email')) order by o)
    from unnest(array['ticket_new', 'ticket_assigned', 'ticket_reply', 'ticket_status', 'request_new', 'request_assigned', 'request_comment', 'request_status']) with ordinality as t (k, o)
  );
end;
$$;

create or replace function public.set_notification_preference(p_tenant_slug text, p_kind text, p_in_app boolean, p_email boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.notification_preferences (tenant_id, user_id, kind, in_app, email)
  values (v_tenant, auth.uid(), p_kind, coalesce(p_in_app, true), coalesce(p_email, false))
  on conflict (tenant_id, user_id, kind) do update set in_app = excluded.in_app, email = excluded.email, updated_at = now();
end;
$$;

-- For administrators: the outbox in numbers (no recipients, no content).
create or replace function public.outbox_summary(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'integrations.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'queued', count(*) filter (where o.status = 'queued'),
      'sent', count(*) filter (where o.status = 'sent' and o.created_at > now() - interval '30 days'),
      'failed', count(*) filter (where o.status = 'failed' and o.created_at > now() - interval '30 days'),
      'oldest_queued_at', min(o.created_at) filter (where o.status = 'queued')
    )
    from public.outbound_messages o where o.tenant_id = v_tenant
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------

-- Settings must not hold secrets: refuse keys that name one (a safety net; secrets belong in the
-- server's secret store, referenced by secret_ref).
create or replace function app.integration_config_safe(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from jsonb_object_keys(p) k where k ~* '(secret|password|passwd|token|api[_-]?key|private|credential)');
$$;
revoke all on function app.integration_config_safe(jsonb) from public;

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null constraint integrations_kind check (kind in ('email', 'lms', 'sis', 'messaging', 'webhook', 'sso')),
  name text not null constraint integrations_name check (char_length(btrim(name)) between 2 and 120),
  status text not null default 'draft' constraint integrations_status check (status in ('draft', 'active', 'paused', 'error')),
  -- Non-secret settings only (e.g. a base URL, a course category); bounded and checked to hold no
  -- obvious secrets.
  config jsonb not null default '{}'::jsonb constraint integrations_config check (
    jsonb_typeof(config) = 'object' and pg_column_size(config) <= 8192 and app.integration_config_safe(config)
  ),
  -- The name of a secret held in the server's secret store (never the secret itself).
  secret_ref text constraint integrations_secret_ref check (secret_ref is null or secret_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  last_ok_at timestamptz,
  last_error_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.integration_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  integration_id uuid not null,
  level text not null constraint integration_logs_level check (level in ('info', 'warning', 'error')),
  event text not null constraint integration_logs_event check (event ~ '^[a-z][a-z0-9_.]{1,59}$'),
  message text constraint integration_logs_message check (message is null or char_length(message) <= 500),
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, integration_id) references public.integrations (tenant_id, id) on delete cascade
);
create index integration_logs_idx on public.integration_logs (integration_id, created_at desc);

create trigger integrations_updated_at before update on public.integrations for each row execute function app.set_updated_at();
create trigger integrations_audit after insert or update or delete on public.integrations for each row execute function app.audit_row_change();

alter table public.integrations enable row level security;
alter table public.integration_logs enable row level security;
revoke all on table public.integrations, public.integration_logs from anon, authenticated;
grant select on table public.integrations, public.integration_logs to authenticated;
create policy integrations_select on public.integrations for select to authenticated
  using (app.has_permission(tenant_id, 'integrations.manage') and app.tenant_has_feature(tenant_id, 'integrations'));
create policy integration_logs_select on public.integration_logs for select to authenticated
  using (app.has_permission(tenant_id, 'integrations.manage') and app.tenant_has_feature(tenant_id, 'integrations'));

create or replace function app.integration_log(p_integration public.integrations, p_level text, p_event text, p_message text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.integration_logs (tenant_id, integration_id, level, event, message, actor_id)
  values (p_integration.tenant_id, p_integration.id, p_level, p_event, left(p_message, 500), auth.uid());
$$;
revoke all on function app.integration_log(public.integrations, text, text, text) from public;

create or replace function public.integration_save(p_tenant_slug text, p_integration uuid, p_kind text, p_name text, p_config jsonb, p_secret_ref text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  i public.integrations;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'integrations.manage') or not app.tenant_has_feature(v_tenant, 'integrations') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_integration is null then
    insert into public.integrations (tenant_id, kind, name, config, secret_ref, created_by)
    values (v_tenant, p_kind, btrim(p_name), coalesce(p_config, '{}'::jsonb), nullif(btrim(p_secret_ref), ''), auth.uid())
    returning * into i;
    perform app.integration_log(i, 'info', 'integration.created', null);
  else
    update public.integrations
    set name = btrim(p_name), config = coalesce(p_config, '{}'::jsonb), secret_ref = nullif(btrim(p_secret_ref), '')
    where id = p_integration and tenant_id = v_tenant
    returning * into i;
    if i.id is null then
      raise exception 'integration not found' using errcode = 'P0002';
    end if;
    perform app.integration_log(i, 'info', 'integration.updated', null);
  end if;
  return i.id;
end;
$$;

-- Activating needs a secret reference: no connector runs without credentials. It does not
-- start anything by itself; the connector (when built) reads the status.
create or replace function public.integration_set_status(p_integration uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.integrations;
begin
  select * into i from public.integrations where id = p_integration;
  if i.id is null or not app.has_permission(i.tenant_id, 'integrations.manage') or not app.tenant_has_feature(i.tenant_id, 'integrations') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('draft', 'active', 'paused') or (p_status = 'active' and i.secret_ref is null) then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.integrations set status = p_status where id = i.id;
  perform app.integration_log(i, 'info', 'integration.status', p_status);
end;
$$;

create or replace function public.integration_delete(p_integration uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.integrations;
begin
  select * into i from public.integrations where id = p_integration;
  if i.id is null or not app.has_permission(i.tenant_id, 'integrations.manage') or not app.tenant_has_feature(i.tenant_id, 'integrations') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.integrations where id = i.id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.my_notification_preferences(text)',
    'public.set_notification_preference(text, text, boolean, boolean)',
    'public.outbox_summary(text)',
    'public.integration_save(text, uuid, text, text, jsonb, text)',
    'public.integration_set_status(uuid, text)',
    'public.integration_delete(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
