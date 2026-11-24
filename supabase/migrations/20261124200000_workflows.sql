-- UniAgent AI · Phase 11 · Migration 17: service request workflows.
--
-- * Workflow definitions ("forms") such as an official transcript or a leave of absence. Each
--   definition has versions: a draft that managers edit, then published versions that never
--   change. A request always keeps the version it was submitted with, so its answers are read
--   against the form the requester saw. Managing forms is routing configuration, like ticket
--   categories: departments.manage, with the feature workflow_agent.
-- * Requests get a tracking number (R-00001 per university) and move through a fixed status
--   flow (submitted → in review → needs information → approved / rejected → completed, or
--   cancelled by the requester). Requesters always confirm before submitting (the app shows a
--   review step); the AI only pre-fills a form for review and never submits.
-- * Who: requesters with tickets.create (seeing their own with tickets.read_own); processors
--   with tickets.update in the form's department (tickets.read_department) or everywhere
--   (tickets.read_all), as for tickets. Nobody processes their own request. Internal notes:
--   tickets.notes.read / write, never shown to the requester.
-- * Status changes and comments notify the other side in-app (the Phase 7 notifications).
-- * The optional AI form suggestion is booked as feature 'workflow_agent' with its own switch,
--   monthly budget and daily limit per person (workflow_settings).
-- * Requests and their history are personal data: not copied into the audit log. Forms,
--   versions and settings are configuration: audited.

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create or replace function app.can_manage_workflows(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.tenant_has_feature(p_tenant, 'workflow_agent') and app.has_permission(p_tenant, 'departments.manage'), false);
$$;

-- Staff who may process a request (same queues as tickets).
create or replace function app.can_process_workflow(p_tenant uuid, p_department uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: also used in PL/pgSQL "if not …" checks, where NULL must mean no.
  select coalesce(app.tenant_has_feature(p_tenant, 'workflow_agent') and app.has_permission(p_tenant, 'tickets.update') and (
    app.has_permission(p_tenant, 'tickets.read_all')
    or (p_department is not null and app.has_permission(p_tenant, 'tickets.read_department') and app.in_department(p_tenant, p_department))
    or p_assignee = auth.uid()
  ), false);
$$;

create or replace function app.can_read_workflow_request(p_tenant uuid, p_requester uuid, p_department uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.tenant_has_feature(p_tenant, 'workflow_agent') and (
    (p_requester = auth.uid() and app.has_permission(p_tenant, 'tickets.read_own'))
    or app.can_process_workflow(p_tenant, p_department, p_assignee)
  ), false);
$$;

-- Internal notes: processors only, never the requester (even when the requester is staff).
create or replace function app.can_read_workflow_notes(p_tenant uuid, p_requester uuid, p_department uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_requester <> auth.uid()
    and app.can_process_workflow(p_tenant, p_department, p_assignee)
    and app.has_permission(p_tenant, 'tickets.notes.read'), false);
$$;

revoke all on function app.can_manage_workflows(uuid), app.can_process_workflow(uuid, uuid, uuid),
  app.can_read_workflow_request(uuid, uuid, uuid, uuid), app.can_read_workflow_notes(uuid, uuid, uuid, uuid) from public;
-- Used inside RLS policies.
grant execute on function app.can_manage_workflows(uuid), app.can_process_workflow(uuid, uuid, uuid),
  app.can_read_workflow_request(uuid, uuid, uuid, uuid), app.can_read_workflow_notes(uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Form fields and answers
-- ---------------------------------------------------------------------------

-- A form: 1–30 fields {key, type, label, label_ar?, help?, help_ar?, required, options? (select)}.
create or replace function app.workflow_fields_valid(p_fields jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  f jsonb;
  o jsonb;
  v_keys text[] := '{}';
  v_values text[];
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) not between 1 and 30 then
    return false;
  end if;
  for f in select x from jsonb_array_elements(p_fields) as x loop
    if jsonb_typeof(f) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(f) k where k not in ('key', 'type', 'label', 'label_ar', 'help', 'help_ar', 'required', 'options')) then
      return false;
    end if;
    if coalesce(f ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$' or (f ->> 'key') = any (v_keys) then
      return false;
    end if;
    v_keys := v_keys || (f ->> 'key');
    if coalesce(f ->> 'type', '') not in ('text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email') then
      return false;
    end if;
    if jsonb_typeof(f -> 'label') is distinct from 'string' or char_length(btrim(f ->> 'label')) not between 1 and 200 then
      return false;
    end if;
    if (f ? 'label_ar' and jsonb_typeof(f -> 'label_ar') <> 'null' and (jsonb_typeof(f -> 'label_ar') <> 'string' or char_length(f ->> 'label_ar') > 200))
       or (f ? 'help' and jsonb_typeof(f -> 'help') <> 'null' and (jsonb_typeof(f -> 'help') <> 'string' or char_length(f ->> 'help') > 500))
       or (f ? 'help_ar' and jsonb_typeof(f -> 'help_ar') <> 'null' and (jsonb_typeof(f -> 'help_ar') <> 'string' or char_length(f ->> 'help_ar') > 500)) then
      return false;
    end if;
    if jsonb_typeof(f -> 'required') is distinct from 'boolean' then
      return false;
    end if;
    if f ->> 'type' = 'select' then
      if jsonb_typeof(f -> 'options') is distinct from 'array' or jsonb_array_length(f -> 'options') not between 1 and 30 then
        return false;
      end if;
      v_values := '{}';
      for o in select x from jsonb_array_elements(f -> 'options') as x loop
        if jsonb_typeof(o) <> 'object'
           or coalesce(o ->> 'value', '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' or (o ->> 'value') = any (v_values)
           or jsonb_typeof(o -> 'label') is distinct from 'string' or char_length(btrim(o ->> 'label')) not between 1 and 120
           or (o ? 'label_ar' and jsonb_typeof(o -> 'label_ar') <> 'null' and (jsonb_typeof(o -> 'label_ar') <> 'string' or char_length(o ->> 'label_ar') > 120)) then
          return false;
        end if;
        v_values := v_values || (o ->> 'value');
      end loop;
    elsif f ? 'options' and jsonb_typeof(f -> 'options') <> 'null' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Check answers against a form and return them normalized ({key: value}); raises 22023
-- ("required: key" / "invalid: key") otherwise. Checkboxes are stored as true/false.
create or replace function app.workflow_answers_clean(p_fields jsonb, p_answers jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  f jsonb;
  v jsonb;
  v_key text;
  v_type text;
  v_text text;
  v_date date;
  v_out jsonb := '{}'::jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 65536 then
    raise exception 'invalid answers' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_answers) k
    where not exists (select 1 from jsonb_array_elements(p_fields) x where x ->> 'key' = k)
  ) then
    raise exception 'unknown field' using errcode = '22023';
  end if;

  for f in select x from jsonb_array_elements(p_fields) as x loop
    v_key := f ->> 'key';
    v_type := f ->> 'type';
    v := p_answers -> v_key;

    if v_type = 'checkbox' then
      if v is not null and jsonb_typeof(v) not in ('boolean', 'null') then
        raise exception 'invalid: %', v_key using errcode = '22023';
      end if;
      if v = 'true'::jsonb then
        v_out := v_out || jsonb_build_object(v_key, true);
      elsif (f ->> 'required')::boolean then
        raise exception 'required: %', v_key using errcode = '22023';
      else
        v_out := v_out || jsonb_build_object(v_key, false);
      end if;
      continue;
    end if;

    if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if (f ->> 'required')::boolean then
        raise exception 'required: %', v_key using errcode = '22023';
      end if;
      continue;
    end if;

    if jsonb_typeof(v) not in ('string', 'number') or (jsonb_typeof(v) = 'number' and v_type <> 'number') then
      raise exception 'invalid: %', v_key using errcode = '22023';
    end if;
    v_text := btrim(v #>> '{}');

    if v_type = 'number' then
      if v_text !~ '^-?[0-9]{1,12}(\.[0-9]{1,4})?$' then
        raise exception 'invalid: %', v_key using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_text::numeric);
      continue;
    end if;

    if (v_type = 'text' and char_length(v_text) > 200)
       or (v_type = 'textarea' and char_length(v_text) > 4000)
       or (v_type = 'email' and (char_length(v_text) > 254 or v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
       or (v_type = 'select' and not exists (select 1 from jsonb_array_elements(f -> 'options') o where o ->> 'value' = v_text)) then
      raise exception 'invalid: %', v_key using errcode = '22023';
    end if;
    if v_type = 'date' then
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'invalid: %', v_key using errcode = '22023';
      end if;
      begin
        v_date := v_text::date;
      exception when others then
        raise exception 'invalid: %', v_key using errcode = '22023';
      end;
      if to_char(v_date, 'YYYY-MM-DD') <> v_text or extract(year from v_date) not between 1900 and 2100 then
        raise exception 'invalid: %', v_key using errcode = '22023';
      end if;
    end if;
    v_out := v_out || jsonb_build_object(v_key, v_text);
  end loop;
  return v_out;
end;
$$;

-- The status flow. Final: rejected, completed, cancelled.
create or replace function app.workflow_next_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_from
    when 'submitted' then p_to in ('in_review', 'needs_info', 'approved', 'rejected', 'completed')
    when 'in_review' then p_to in ('needs_info', 'approved', 'rejected', 'completed')
    when 'needs_info' then p_to in ('in_review', 'approved', 'rejected')
    when 'approved' then p_to = 'completed'
    else false
  end, false);
$$;

revoke all on function app.workflow_fields_valid(jsonb), app.workflow_answers_clean(jsonb, jsonb), app.workflow_next_allowed(text, text) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null constraint workflow_definitions_key check (key ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  title text not null constraint workflow_definitions_title check (char_length(btrim(title)) between 2 and 160),
  title_ar text constraint workflow_definitions_title_ar check (title_ar is null or char_length(btrim(title_ar)) between 2 and 160),
  description text constraint workflow_definitions_description check (description is null or char_length(description) <= 1000),
  description_ar text constraint workflow_definitions_description_ar check (description_ar is null or char_length(description_ar) <= 1000),
  -- Who processes the requests; null: the general queue (tickets.read_all).
  department_id uuid,
  -- draft: never published · active: requesters see it · archived: no new requests.
  status text not null default 'draft' constraint workflow_definitions_status check (status in ('draft', 'active', 'archived')),
  current_version_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id) on delete set null (department_id)
);

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  definition_id uuid not null,
  version_no integer not null constraint workflow_versions_no check (version_no >= 1),
  fields jsonb not null constraint workflow_versions_fields check (app.workflow_fields_valid(fields)),
  instructions text constraint workflow_versions_instructions check (instructions is null or char_length(instructions) <= 2000),
  instructions_ar text constraint workflow_versions_instructions_ar check (instructions_ar is null or char_length(instructions_ar) <= 2000),
  -- Shown on the review step before the requester confirms.
  confirmation text constraint workflow_versions_confirmation check (confirmation is null or char_length(confirmation) <= 1000),
  confirmation_ar text constraint workflow_versions_confirmation_ar check (confirmation_ar is null or char_length(confirmation_ar) <= 1000),
  status text not null default 'draft' constraint workflow_versions_status check (status in ('draft', 'published', 'retired')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  unique (definition_id, version_no),
  unique (tenant_id, id),
  foreign key (tenant_id, definition_id) references public.workflow_definitions (tenant_id, id) on delete cascade
);
create unique index workflow_versions_one_draft_idx on public.workflow_versions (definition_id) where status = 'draft';
create unique index workflow_versions_one_published_idx on public.workflow_versions (definition_id) where status = 'published';

alter table public.workflow_definitions
  add constraint workflow_definitions_current_version foreign key (tenant_id, current_version_id)
  references public.workflow_versions (tenant_id, id) on delete set null (current_version_id);

create table public.workflow_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reference text not null constraint workflow_requests_reference check (reference ~ '^R-[0-9]{5,}$'),
  definition_id uuid not null,
  version_id uuid not null,
  department_id uuid,
  requester_id uuid not null references auth.users (id) on delete cascade,
  requester_name text not null constraint workflow_requests_requester_name check (char_length(requester_name) between 1 and 200),
  assignee_id uuid references auth.users (id) on delete set null,
  status text not null default 'submitted' constraint workflow_requests_status
    check (status in ('submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'completed', 'cancelled')),
  answers jsonb not null constraint workflow_requests_answers check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 65536),
  -- 'assistant': the requester started from an AI suggestion (and still reviewed and confirmed it).
  source text not null default 'form' constraint workflow_requests_source check (source in ('form', 'assistant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, reference),
  unique (tenant_id, id),
  foreign key (tenant_id, definition_id) references public.workflow_definitions (tenant_id, id),
  foreign key (tenant_id, version_id) references public.workflow_versions (tenant_id, id),
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id) on delete set null (department_id)
);
create index workflow_requests_requester_idx on public.workflow_requests (requester_id, tenant_id, created_at desc);
create index workflow_requests_queue_idx on public.workflow_requests (tenant_id, department_id, status, last_activity_at desc);

create table public.workflow_request_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  request_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text constraint workflow_events_actor_name check (actor_name is null or char_length(actor_name) <= 200),
  kind text not null constraint workflow_events_kind check (kind in ('submitted', 'status', 'comment', 'note', 'assigned', 'cancelled')),
  from_status text,
  to_status text,
  body text constraint workflow_events_body check (body is null or char_length(body) between 1 and 4000),
  -- Internal events (notes, assignments) are never shown to the requester.
  internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint workflow_events_note_internal check (kind not in ('note', 'assigned') or internal),
  foreign key (tenant_id, request_id) references public.workflow_requests (tenant_id, id) on delete cascade
);
create index workflow_request_events_request_idx on public.workflow_request_events (request_id, created_at);

create table public.workflow_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  ai_enabled boolean not null default false,
  monthly_budget_usd numeric(10, 2) not null default 10
    constraint workflow_settings_budget check (monthly_budget_usd >= 0 and monthly_budget_usd <= 100000),
  daily_limit integer not null default 20 constraint workflow_settings_daily_limit check (daily_limit between 1 and 200),
  updated_at timestamptz not null default now()
);

create table app.workflow_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number integer not null default 0
);
alter table app.workflow_counters enable row level security;
revoke all on table app.workflow_counters from public;

-- Notifications (Phase 7) also point to requests.
alter table public.notifications add column request_id uuid;
alter table public.notifications
  add constraint notifications_request foreign key (tenant_id, request_id) references public.workflow_requests (tenant_id, id) on delete cascade,
  add constraint notifications_one_target check (ticket_id is null or request_id is null);
alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind check (kind in (
  'ticket_new', 'ticket_assigned', 'ticket_reply', 'ticket_status',
  'request_new', 'request_assigned', 'request_comment', 'request_status'
));

-- Published and retired versions never change (only published → retired).
create or replace function app.workflow_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.fields is distinct from old.fields or new.instructions is distinct from old.instructions
    or new.instructions_ar is distinct from old.instructions_ar or new.confirmation is distinct from old.confirmation
    or new.confirmation_ar is distinct from old.confirmation_ar or new.version_no <> old.version_no
    or new.definition_id <> old.definition_id or new.tenant_id <> old.tenant_id
    or not (new.status = old.status or (old.status = 'published' and new.status = 'retired'))
  ) then
    raise exception 'published versions cannot change' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger workflow_versions_guard before update on public.workflow_versions
  for each row execute function app.workflow_versions_guard();
create trigger workflow_definitions_updated_at before update on public.workflow_definitions
  for each row execute function app.set_updated_at();
create trigger workflow_requests_updated_at before update on public.workflow_requests
  for each row execute function app.set_updated_at();
create trigger workflow_settings_updated_at before update on public.workflow_settings
  for each row execute function app.set_updated_at();
-- Configuration is audited; requests and their history (personal data) are not.
create trigger workflow_definitions_audit after insert or update or delete on public.workflow_definitions
  for each row execute function app.audit_row_change();
create trigger workflow_versions_audit after insert or update or delete on public.workflow_versions
  for each row execute function app.audit_row_change();
create trigger workflow_settings_audit after insert or update or delete on public.workflow_settings
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS (reads only; every write goes through the functions below)
-- ---------------------------------------------------------------------------

alter table public.workflow_definitions enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_requests enable row level security;
alter table public.workflow_request_events enable row level security;
alter table public.workflow_settings enable row level security;

revoke all on table public.workflow_definitions, public.workflow_versions, public.workflow_requests,
  public.workflow_request_events, public.workflow_settings from anon, authenticated;
grant select on table public.workflow_definitions, public.workflow_versions, public.workflow_requests,
  public.workflow_request_events, public.workflow_settings to authenticated;

-- Forms are not personal data: members see forms that were published (active or archived);
-- drafts only form managers.
create policy workflow_definitions_select on public.workflow_definitions for select to authenticated
  using (app.is_tenant_member(tenant_id) and app.tenant_has_feature(tenant_id, 'workflow_agent')
         and (status <> 'draft' or app.can_manage_workflows(tenant_id)));
create policy workflow_versions_select on public.workflow_versions for select to authenticated
  using (app.is_tenant_member(tenant_id) and app.tenant_has_feature(tenant_id, 'workflow_agent')
         and (status <> 'draft' or app.can_manage_workflows(tenant_id)));
create policy workflow_requests_select on public.workflow_requests for select to authenticated
  using (app.can_read_workflow_request(tenant_id, requester_id, department_id, assignee_id));
create policy workflow_request_events_select on public.workflow_request_events for select to authenticated
  using (exists (
    select 1 from public.workflow_requests r
    where r.id = request_id
      and app.can_read_workflow_request(r.tenant_id, r.requester_id, r.department_id, r.assignee_id)
      and (not internal or app.can_read_workflow_notes(r.tenant_id, r.requester_id, r.department_id, r.assignee_id))
  ));
create policy workflow_settings_select on public.workflow_settings for select to authenticated
  using (app.has_permission(tenant_id, 'assistant.configure'));

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function app.next_workflow_reference(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into app.workflow_counters as c (tenant_id, last_number) values (p_tenant, 1)
  on conflict (tenant_id) do update set last_number = c.last_number + 1
  returning last_number into v_n;
  return 'R-' || lpad(v_n::text, 5, '0');
end;
$$;

create or replace function app.notify_request(p_tenant uuid, p_users uuid[], p_kind text, p_request uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (tenant_id, user_id, kind, request_id)
  select p_tenant, u, p_kind, p_request
  from (select distinct unnest(p_users) as u) x
  where u is not null and u is distinct from auth.uid();
$$;

create or replace function app.workflow_event(p_request public.workflow_requests, p_kind text, p_from text, p_to text, p_body text, p_internal boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.workflow_request_events (tenant_id, request_id, actor_id, actor_name, kind, from_status, to_status, body, internal)
  values (p_request.tenant_id, p_request.id, auth.uid(), left(app.display_name(auth.uid()), 200), p_kind, p_from, p_to, p_body, p_internal);
$$;

revoke all on function app.next_workflow_reference(uuid), app.notify_request(uuid, uuid[], text, uuid),
  app.workflow_event(public.workflow_requests, text, text, text, text, boolean) from public;

-- ---------------------------------------------------------------------------
-- API: forms (managers)
-- ---------------------------------------------------------------------------

create or replace function public.workflow_save_definition(
  p_tenant_slug text,
  p_definition uuid,
  p_key text,
  p_title text,
  p_title_ar text,
  p_description text,
  p_description_ar text,
  p_department uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_id uuid;
begin
  if v_tenant is null or not app.can_manage_workflows(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_definition is null then
    insert into public.workflow_definitions (tenant_id, key, title, title_ar, description, description_ar, department_id, created_by)
    values (v_tenant, lower(btrim(p_key)), btrim(p_title), nullif(btrim(p_title_ar), ''), nullif(btrim(p_description), ''),
            nullif(btrim(p_description_ar), ''), p_department, auth.uid())
    returning id into v_id;
  else
    update public.workflow_definitions
    set key = lower(btrim(p_key)), title = btrim(p_title), title_ar = nullif(btrim(p_title_ar), ''),
        description = nullif(btrim(p_description), ''), description_ar = nullif(btrim(p_description_ar), ''),
        department_id = p_department
    where id = p_definition and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then
      raise exception 'form not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- Create or replace the draft version of a form.
create or replace function public.workflow_save_draft(
  p_definition uuid,
  p_fields jsonb,
  p_instructions text,
  p_instructions_ar text,
  p_confirmation text,
  p_confirmation_ar text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.workflow_definitions;
  v_id uuid;
begin
  select * into d from public.workflow_definitions where id = p_definition;
  if d.id is null or not app.can_manage_workflows(d.tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not app.workflow_fields_valid(p_fields) then
    raise exception 'invalid fields' using errcode = '22023';
  end if;
  update public.workflow_versions
  set fields = p_fields, instructions = nullif(btrim(p_instructions), ''), instructions_ar = nullif(btrim(p_instructions_ar), ''),
      confirmation = nullif(btrim(p_confirmation), ''), confirmation_ar = nullif(btrim(p_confirmation_ar), '')
  where definition_id = d.id and status = 'draft'
  returning id into v_id;
  if v_id is null then
    insert into public.workflow_versions (tenant_id, definition_id, version_no, fields, instructions, instructions_ar, confirmation, confirmation_ar, created_by)
    values (d.tenant_id, d.id, coalesce((select max(v.version_no) from public.workflow_versions v where v.definition_id = d.id), 0) + 1,
            p_fields, nullif(btrim(p_instructions), ''), nullif(btrim(p_instructions_ar), ''),
            nullif(btrim(p_confirmation), ''), nullif(btrim(p_confirmation_ar), ''), auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Publish the draft: it becomes the form requesters see; the previous version is retired (requests
-- made with it keep it).
create or replace function public.workflow_publish(p_definition uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.workflow_definitions;
  v public.workflow_versions;
begin
  select * into d from public.workflow_definitions where id = p_definition for update;
  if d.id is null or not app.can_manage_workflows(d.tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v from public.workflow_versions where definition_id = d.id and status = 'draft';
  if v.id is null then
    raise exception 'nothing to publish' using errcode = '22023';
  end if;
  update public.workflow_versions set status = 'retired' where definition_id = d.id and status = 'published';
  update public.workflow_versions set status = 'published', published_at = now(), published_by = auth.uid() where id = v.id;
  update public.workflow_definitions set current_version_id = v.id, status = 'active' where id = d.id;
  return v.version_no;
end;
$$;

create or replace function public.workflow_discard_draft(p_definition uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.workflow_definitions;
begin
  select * into d from public.workflow_definitions where id = p_definition;
  if d.id is null or not app.can_manage_workflows(d.tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.workflow_versions where definition_id = d.id and status = 'draft';
end;
$$;

-- active (needs a published version) or archived (no new requests; open requests continue).
create or replace function public.workflow_set_status(p_definition uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.workflow_definitions;
begin
  select * into d from public.workflow_definitions where id = p_definition;
  if d.id is null or not app.can_manage_workflows(d.tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'archived') or (p_status = 'active' and d.current_version_id is null) then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.workflow_definitions set status = p_status where id = d.id;
end;
$$;

-- Only forms that never received a request can be deleted (otherwise archive them).
create or replace function public.workflow_delete_definition(p_definition uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.workflow_definitions;
begin
  select * into d from public.workflow_definitions where id = p_definition;
  if d.id is null or not app.can_manage_workflows(d.tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.workflow_requests r where r.definition_id = d.id) then
    raise exception 'form has requests' using errcode = '23503';
  end if;
  update public.workflow_definitions set current_version_id = null where id = d.id;
  delete from public.workflow_definitions where id = d.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- API: requesters
-- ---------------------------------------------------------------------------

-- Submit a request with the version the requester reviewed. If the form changed in the
-- meantime, 40001: the app asks them to review the new form. At most 20 requests a day.
create or replace function public.workflow_submit(p_tenant_slug text, p_definition uuid, p_version uuid, p_answers jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  d public.workflow_definitions;
  v public.workflow_versions;
  r public.workflow_requests;
  v_answers jsonb;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tickets.create') or not app.tenant_has_feature(v_tenant, 'workflow_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(p_source, '') not in ('form', 'assistant') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  select * into d from public.workflow_definitions where id = p_definition and tenant_id = v_tenant and status = 'active';
  if d.id is null then
    raise exception 'form not available' using errcode = 'P0002';
  end if;
  if d.current_version_id is distinct from p_version then
    raise exception 'the form has changed' using errcode = '40001';
  end if;
  select * into v from public.workflow_versions where id = d.current_version_id;
  v_answers := app.workflow_answers_clean(v.fields, p_answers);
  if (select count(*) from public.workflow_requests x
      where x.tenant_id = v_tenant and x.requester_id = auth.uid() and x.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;

  insert into public.workflow_requests (tenant_id, reference, definition_id, version_id, department_id, requester_id, requester_name, answers, source)
  values (v_tenant, app.next_workflow_reference(v_tenant), d.id, v.id, d.department_id, auth.uid(),
          left(app.display_name(auth.uid()), 200), v_answers, p_source)
  returning * into r;
  perform app.workflow_event(r, 'submitted', null, 'submitted', null, false);
  perform app.notify_request(v_tenant, array(select app.ticket_queue_staff(v_tenant, d.department_id)), 'request_new', r.id);
  return jsonb_build_object('id', r.id, 'reference', r.reference);
end;
$$;

-- Cancel one's own request while it is not decided.
create or replace function public.workflow_cancel(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.workflow_requests;
begin
  select * into r from public.workflow_requests where id = p_request for update;
  if r.id is null or r.requester_id <> auth.uid() or not app.can_read_workflow_request(r.tenant_id, r.requester_id, r.department_id, r.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.status not in ('submitted', 'in_review', 'needs_info') then
    raise exception 'request is closed' using errcode = '55000';
  end if;
  update public.workflow_requests set status = 'cancelled', closed_at = now(), last_activity_at = now() where id = r.id;
  perform app.workflow_event(r, 'cancelled', r.status, 'cancelled', null, false);
  perform app.notify_request(r.tenant_id, array[r.assignee_id], 'request_status', r.id);
end;
$$;

-- A comment: requesters (public only; answering "needs information" moves the request back to
-- review), processors (public, or an internal note with tickets.notes.write).
create or replace function public.workflow_comment(p_request uuid, p_body text, p_internal boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.workflow_requests;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into r from public.workflow_requests where id = p_request for update;
  if r.id is null or not app.can_read_workflow_request(r.tenant_id, r.requester_id, r.department_id, r.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid comment' using errcode = '22023';
  end if;

  if r.requester_id = auth.uid() then
    if coalesce(p_internal, false) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if r.status in ('rejected', 'completed', 'cancelled') then
      raise exception 'request is closed' using errcode = '55000';
    end if;
    perform app.workflow_event(r, 'comment', null, null, v_body, false);
    if r.status = 'needs_info' then
      update public.workflow_requests set status = 'in_review', last_activity_at = now() where id = r.id;
      perform app.workflow_event(r, 'status', 'needs_info', 'in_review', null, false);
    else
      update public.workflow_requests set last_activity_at = now() where id = r.id;
    end if;
    if r.assignee_id is not null then
      perform app.notify_request(r.tenant_id, array[r.assignee_id], 'request_comment', r.id);
    else
      perform app.notify_request(r.tenant_id, array(select app.ticket_queue_staff(r.tenant_id, r.department_id)), 'request_comment', r.id);
    end if;
  elsif app.can_process_workflow(r.tenant_id, r.department_id, r.assignee_id) then
    if coalesce(p_internal, false) then
      if not app.has_permission(r.tenant_id, 'tickets.notes.write') then
        raise exception 'not authorized' using errcode = '42501';
      end if;
      perform app.workflow_event(r, 'note', null, null, v_body, true);
    else
      if r.status in ('rejected', 'completed', 'cancelled') then
        raise exception 'request is closed' using errcode = '55000';
      end if;
      perform app.workflow_event(r, 'comment', null, null, v_body, false);
      update public.workflow_requests set last_activity_at = now() where id = r.id;
      perform app.notify_request(r.tenant_id, array[r.requester_id], 'request_comment', r.id);
    end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- API: processors
-- ---------------------------------------------------------------------------

-- Move a request along the status flow. "Needs information" and "rejected" need a message
-- for the requester. Nobody processes their own request.
create or replace function public.workflow_update_status(p_request uuid, p_status text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.workflow_requests;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into r from public.workflow_requests where id = p_request for update;
  if r.id is null or r.requester_id = auth.uid() or not app.can_process_workflow(r.tenant_id, r.department_id, r.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not app.workflow_next_allowed(r.status, p_status) then
    raise exception 'status change not allowed' using errcode = '22023';
  end if;
  if (v_message is not null and char_length(v_message) > 4000)
     or (p_status in ('needs_info', 'rejected') and coalesce(char_length(v_message), 0) < 3) then
    raise exception 'a message for the requester is required' using errcode = '22023';
  end if;
  update public.workflow_requests
  set status = p_status, last_activity_at = now(),
      closed_at = case when p_status in ('rejected', 'completed') then now() else null end
  where id = r.id;
  perform app.workflow_event(r, 'status', r.status, p_status, v_message, false);
  perform app.notify_request(r.tenant_id, array[r.requester_id], 'request_status', r.id);
end;
$$;

-- Assign: oneself (processors), or anyone who works the queue (tickets.assign). Unassign:
-- the assignee themselves, or tickets.assign.
create or replace function public.workflow_assign(p_request uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.workflow_requests;
begin
  select * into r from public.workflow_requests where id = p_request for update;
  if r.id is null or r.requester_id = auth.uid() or not app.can_process_workflow(r.tenant_id, r.department_id, r.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.status in ('rejected', 'completed', 'cancelled') then
    raise exception 'request is closed' using errcode = '55000';
  end if;
  if p_assignee is null then
    if r.assignee_id is distinct from auth.uid() and not app.has_permission(r.tenant_id, 'tickets.assign') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_assignee <> auth.uid() then
    if not app.has_permission(r.tenant_id, 'tickets.assign') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if p_assignee = r.requester_id or not exists (select 1 from app.ticket_queue_staff(r.tenant_id, r.department_id) s (id) where s.id = p_assignee) then
      raise exception 'assignee cannot work this queue' using errcode = '22023';
    end if;
  end if;
  if r.assignee_id is not distinct from p_assignee then
    return;
  end if;
  update public.workflow_requests set assignee_id = p_assignee, last_activity_at = now() where id = r.id;
  perform app.workflow_event(r, 'assigned', null, null, case when p_assignee is null then null else left(app.display_name(p_assignee), 200) end, true);
  perform app.notify_request(r.tenant_id, array[p_assignee], 'request_assigned', r.id);
end;
$$;

create or replace function public.workflow_assignees(p_tenant_slug text, p_department uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tickets.assign') or not app.can_process_workflow(v_tenant, p_department, null) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', s.id, 'name', app.display_name(s.id)) order by app.display_name(s.id))
    from app.ticket_queue_staff(v_tenant, p_department) as s (id)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- API: settings and the AI form suggestion
-- ---------------------------------------------------------------------------

create or replace function public.workflow_status(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.workflow_settings;
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.workflow_settings where tenant_id = v_tenant;
  return jsonb_build_object(
    'feature', app.tenant_has_feature(v_tenant, 'workflow_agent'),
    'can_submit', app.has_permission(v_tenant, 'tickets.create'),
    'ai_enabled', coalesce(s.ai_enabled, false),
    'ai_within_budget', s.tenant_id is not null and app.ai_month_cost(v_tenant, 'workflow_agent') < s.monthly_budget_usd
  );
end;
$$;

create or replace function public.workflow_update_settings(p_tenant_slug text, p_ai_enabled boolean, p_monthly_budget_usd numeric, p_daily_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.configure') or not app.tenant_has_feature(v_tenant, 'workflow_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.workflow_settings (tenant_id, ai_enabled, monthly_budget_usd, daily_limit)
  values (v_tenant, coalesce(p_ai_enabled, false), p_monthly_budget_usd, p_daily_limit)
  on conflict (tenant_id) do update
    set ai_enabled = excluded.ai_enabled, monthly_budget_usd = excluded.monthly_budget_usd, daily_limit = excluded.daily_limit;
end;
$$;

-- Before an AI form suggestion: a requester, the switch, the budget, the daily limit.
create or replace function public.workflow_ai_begin(p_tenant_slug text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.workflow_settings;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tickets.create') or not app.tenant_has_feature(v_tenant, 'workflow_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.workflow_settings where tenant_id = v_tenant;
  if s.tenant_id is null or not s.ai_enabled then
    raise exception 'form suggestions are turned off' using errcode = '55000';
  end if;
  if app.ai_month_cost(v_tenant, 'workflow_agent') >= s.monthly_budget_usd then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if (select count(*) from public.ai_usage_events u
      where u.tenant_id = v_tenant and u.user_id = auth.uid() and u.feature = 'workflow_agent' and u.created_at > now() - interval '24 hours')
     >= s.daily_limit then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;
end;
$$;

create or replace function public.workflow_ai_record(p_tenant_slug text, p_model text, p_usage jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tickets.create') or not app.tenant_has_feature(v_tenant, 'workflow_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.ai_usage_events (tenant_id, user_id, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
  values (v_tenant, auth.uid(), 'workflow_agent', p_model,
          coalesce((p_usage ->> 'input_tokens')::integer, 0), coalesce((p_usage ->> 'output_tokens')::integer, 0),
          coalesce((p_usage ->> 'cache_read_tokens')::integer, 0), coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
          coalesce((p_usage ->> 'cost_usd')::numeric, 0));
end;
$$;

-- This month, for the settings page (assistant.configure): requests and AI suggestions.
create or replace function public.workflow_usage(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_since timestamptz := date_trunc('month', now());
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.configure') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'since', v_since,
    'requests', (select count(*) from public.workflow_requests r where r.tenant_id = v_tenant and r.created_at >= v_since),
    'from_assistant', (select count(*) from public.workflow_requests r where r.tenant_id = v_tenant and r.created_at >= v_since and r.source = 'assistant'),
    'suggestions', (select count(*) from public.ai_usage_events u where u.tenant_id = v_tenant and u.feature = 'workflow_agent' and u.created_at >= v_since),
    'cost_usd', app.ai_month_cost(v_tenant, 'workflow_agent')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- API: notifications (tickets and requests)
-- ---------------------------------------------------------------------------

create or replace function public.my_notifications(p_tenant_slug text, p_limit integer default 30)
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
  return coalesce((
    select jsonb_agg(x order by (x ->> 'created_at') desc)
    from (
      select x
      from (
        select jsonb_build_object(
          'id', n.id, 'kind', n.kind, 'created_at', n.created_at, 'read', n.read_at is not null,
          'ticket_id', t.id, 'reference', t.reference, 'subject', t.subject,
          'mine', t.requester_id = auth.uid()
        ) as x, n.created_at
        from public.notifications n
        join public.tickets t on t.id = n.ticket_id
        where n.user_id = auth.uid() and n.tenant_id = v_tenant
          and app.can_read_ticket(t.tenant_id, t.requester_id, t.department_id, t.assignee_id)
        union all
        select jsonb_build_object(
          'id', n.id, 'kind', n.kind, 'created_at', n.created_at, 'read', n.read_at is not null,
          'request_id', r.id, 'reference', r.reference, 'subject', d.title, 'subject_ar', d.title_ar,
          'mine', r.requester_id = auth.uid()
        ) as x, n.created_at
        from public.notifications n
        join public.workflow_requests r on r.id = n.request_id
        join public.workflow_definitions d on d.id = r.definition_id
        where n.user_id = auth.uid() and n.tenant_id = v_tenant
          and app.can_read_workflow_request(r.tenant_id, r.requester_id, r.department_id, r.assignee_id)
      ) q
      order by q.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) l
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics: service requests and the form suggestion's AI cost (replaces migration 16's)
-- ---------------------------------------------------------------------------

create or replace function public.analytics_overview(p_tenant_slug text, p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_tz text;
  v_first date;
  v_since timestamptz;
  v_today date;
  v_step integer;
  v_student boolean;
  v_admissions boolean;
  v_staff boolean;
  v_assistant jsonb;
  v_tickets jsonb;
  v_leads jsonb;
  v_knowledge jsonb;
  v_ai jsonb;
  v_quality jsonb;
  v_academic jsonb;
  v_workflows jsonb;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'analytics.view') or not app.tenant_has_feature(v_tenant, 'analytics_basic') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if p_days > 30 and not app.tenant_has_feature(v_tenant, 'analytics_advanced') then
    raise exception 'longer periods need advanced analytics' using errcode = '42501';
  end if;

  select a.tz, a.first_day, a.since into v_tz, v_first, v_since from app.analytics_period(v_tenant, p_days) as a;
  v_today := (now() at time zone v_tz)::date;
  v_step := case when p_days > 31 then 7 else 1 end;
  v_student := app.tenant_has_feature(v_tenant, 'student_assistant');
  v_admissions := app.tenant_has_feature(v_tenant, 'admissions_agent');
  v_staff := app.tenant_has_feature(v_tenant, 'staff_assistant');

  -- Assistants: questions, outcomes, people, feedback and a series per day (or week).
  if v_student or v_admissions or v_staff then
    with m as (
      select c.agent, m.role, m.status, m.latency_ms, c.user_id,
             v_first + v_step * ((((m.created_at at time zone v_tz)::date) - v_first) / v_step) as bucket
      from public.assistant_messages m
      join public.assistant_conversations c on c.id = m.conversation_id
      where m.tenant_id = v_tenant and m.created_at >= v_since
    ),
    totals as (
      select m.agent,
             count(*) filter (where m.role = 'user') as questions,
             count(*) filter (where m.role = 'assistant' and m.status = 'answered') as answered,
             count(*) filter (where m.role = 'assistant' and m.status = 'no_sources') as no_sources,
             count(*) filter (where m.role = 'assistant' and m.status = 'refused') as refused,
             count(*) filter (where m.role = 'assistant' and m.status = 'error') as errors,
             count(distinct m.user_id) filter (where m.role = 'user') as people,
             percentile_cont(0.5) within group (order by m.latency_ms::double precision)
               filter (where m.role = 'assistant' and m.status = 'answered' and m.latency_ms is not null) as median_latency_ms
      from m
      group by m.agent
    ),
    per_bucket as (
      select m.agent, m.bucket,
             count(*) filter (where m.role = 'user') as questions,
             count(*) filter (where m.role = 'assistant' and m.status = 'answered') as answered,
             count(*) filter (where m.role = 'assistant' and m.status = 'no_sources') as gaps
      from m
      group by m.agent, m.bucket
    ),
    fb as (
      select c.agent, count(*) filter (where f.rating = 1) as helpful, count(*) filter (where f.rating = -1) as not_helpful
      from public.assistant_feedback f
      join public.assistant_messages mm on mm.id = f.message_id
      join public.assistant_conversations c on c.id = mm.conversation_id
      where f.tenant_id = v_tenant and f.created_at >= v_since
      group by c.agent
    ),
    agents (agent) as (
      select 'student' where v_student
      union all
      select 'admissions' where v_admissions
      union all
      select 'staff' where v_staff
    )
    select jsonb_object_agg(a.agent, jsonb_build_object(
      'questions', coalesce(t.questions, 0),
      'answered', coalesce(t.answered, 0),
      'no_sources', coalesce(t.no_sources, 0),
      'refused', coalesce(t.refused, 0),
      'errors', coalesce(t.errors, 0),
      'people', coalesce(t.people, 0),
      'helpful', coalesce(f.helpful, 0),
      'not_helpful', coalesce(f.not_helpful, 0),
      'median_latency_ms', round(t.median_latency_ms::numeric),
      'series', (
        select jsonb_agg(jsonb_build_object(
          'start', b.bucket,
          'questions', coalesce(s.questions, 0),
          'answered', coalesce(s.answered, 0),
          'gaps', coalesce(s.gaps, 0)
        ) order by b.bucket)
        from (select v_first + g * v_step as bucket from generate_series(0, (p_days - 1) / v_step) as g) as b
        left join per_bucket s on s.agent = a.agent and s.bucket = b.bucket
      )
    ))
    into v_assistant
    from agents a
    left join totals t on t.agent = a.agent
    left join fb f on f.agent = a.agent;
  end if;

  -- Tickets: volume, backlog, response and resolution times, queues and categories.
  if app.tenant_has_feature(v_tenant, 'ticketing') then
    with t as (
      select tk.id, tk.status, tk.source, tk.department_id, tk.category_id, tk.assignee_id, tk.created_at, tk.first_response_at,
             coalesce(tk.resolved_at, tk.closed_at) as done_at,
             tk.status in ('open', 'in_progress', 'waiting') as is_open
      from public.tickets tk
      where tk.tenant_id = v_tenant
        and (tk.created_at >= v_since or tk.status in ('open', 'in_progress', 'waiting') or coalesce(tk.resolved_at, tk.closed_at) >= v_since)
    )
    select jsonb_build_object(
      'created', count(*) filter (where t.created_at >= v_since),
      'from_assistant', count(*) filter (where t.created_at >= v_since and t.source = 'assistant'),
      'resolved', count(*) filter (where t.status in ('resolved', 'closed') and t.done_at >= v_since),
      'open_now', count(*) filter (where t.is_open),
      'open_by_status', jsonb_build_object(
        'open', count(*) filter (where t.status = 'open'),
        'in_progress', count(*) filter (where t.status = 'in_progress'),
        'waiting', count(*) filter (where t.status = 'waiting')
      ),
      'unassigned_now', count(*) filter (where t.is_open and t.assignee_id is null),
      'awaiting_first_response', count(*) filter (where t.is_open and t.first_response_at is null),
      'median_first_response_minutes', round((percentile_cont(0.5) within group (order by (extract(epoch from t.first_response_at - t.created_at) / 60)::double precision)
        filter (where t.created_at >= v_since and t.first_response_at is not null))::numeric),
      'median_resolution_hours', round((percentile_cont(0.5) within group (order by (extract(epoch from t.done_at - t.created_at) / 3600)::double precision)
        filter (where t.status in ('resolved', 'closed') and t.done_at >= v_since))::numeric, 1),
      'by_department', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.department_id, 'name', d.name, 'name_ar', d.name_translations ->> 'ar', 'open', x.open, 'created', x.created)
                         order by x.open desc, x.created desc, d.name)
        from (
          select t2.department_id, count(*) filter (where t2.is_open) as open, count(*) filter (where t2.created_at >= v_since) as created
          from t as t2
          group by t2.department_id
        ) as x
        left join public.departments d on d.id = x.department_id
        where x.open > 0 or x.created > 0
      ), '[]'::jsonb),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.category_id, 'name', k.name, 'name_ar', k.name_ar, 'created', x.created)
                         order by x.created desc, k.name)
        from (
          select t2.category_id, count(*) as created
          from t as t2
          where t2.created_at >= v_since
          group by t2.category_id
        ) as x
        left join public.ticket_categories k on k.id = x.category_id
      ), '[]'::jsonb),
      'series', (
        select jsonb_agg(jsonb_build_object(
          'start', b.bucket,
          'created', (select count(*) from t as t3 where t3.created_at >= v_since
                        and v_first + v_step * ((((t3.created_at at time zone v_tz)::date) - v_first) / v_step) = b.bucket),
          'resolved', (select count(*) from t as t3 where t3.status in ('resolved', 'closed') and t3.done_at >= v_since
                        and v_first + v_step * ((((t3.done_at at time zone v_tz)::date) - v_first) / v_step) = b.bucket)
        ) order by b.bucket)
        from (select v_first + g * v_step as bucket from generate_series(0, (p_days - 1) / v_step) as g) as b
      )
    )
    into v_tickets
    from t;
  end if;

  -- Admissions inquiries received (the admissions page has the full pipeline).
  if v_admissions then
    select jsonb_build_object(
      'leads', count(*),
      'by_source', jsonb_build_object(
        'form', count(*) filter (where l.source = 'form'),
        'assistant', count(*) filter (where l.source = 'assistant'),
        'manual', count(*) filter (where l.source = 'manual')
      )
    )
    into v_leads
    from public.admission_leads l
    where l.tenant_id = v_tenant and l.created_at >= v_since;
  end if;

  -- Knowledge base: what is published, what expired, and which documents answered most.
  if app.tenant_has_feature(v_tenant, 'knowledge_base') then
    select jsonb_build_object(
      'published', count(*) filter (where d.published_at is not null and d.archived_at is null and d.current_version_id is not null
                                     and (d.expiry_date is null or d.expiry_date >= v_today)),
      'expired', count(*) filter (where d.published_at is not null and d.archived_at is null and d.expiry_date < v_today),
      'unpublished', count(*) filter (where d.published_at is null and d.archived_at is null),
      'top_cited', coalesce((
        select jsonb_agg(jsonb_build_object('id', y.id, 'title', y.title, 'title_ar', y.title_ar, 'answers', y.answers) order by y.answers desc, y.title)
        from (
          select kd.id, kd.title, kd.title_ar, x.answers
          from (
            select app.try_uuid(c ->> 'document_id') as doc, count(distinct m.id) as answers
            from public.assistant_messages m
            cross join lateral jsonb_array_elements(m.citations) as c
            where m.tenant_id = v_tenant and m.role = 'assistant' and m.status = 'answered' and m.created_at >= v_since
              and jsonb_typeof(c) = 'object' and not (c ? 'program_id')
            group by 1
          ) as x
          join public.knowledge_documents kd on kd.id = x.doc and kd.tenant_id = v_tenant and kd.course_id is null
          where app.can_read_knowledge(v_tenant, kd.id)
          order by x.answers desc, kd.title
          limit 10
        ) as y
      ), '[]'::jsonb)
    )
    into v_knowledge
    from public.knowledge_documents d
    where d.tenant_id = v_tenant and d.course_id is null;
  end if;

  -- AI usage and estimated cost (calendar month, as the budgets are enforced).
  if app.has_permission(v_tenant, 'analytics.ai_costs.view') then
    select jsonb_build_object(
      'month_since', date_trunc('month', now()),
      'month', jsonb_build_object(
        'student_assistant', coalesce(sum(u.cost_usd) filter (where u.feature = 'student_assistant' and u.created_at >= date_trunc('month', now())), 0),
        'admissions_agent', coalesce(sum(u.cost_usd) filter (where u.feature = 'admissions_agent' and u.created_at >= date_trunc('month', now())), 0),
        'ticketing', coalesce(sum(u.cost_usd) filter (where u.feature = 'ticketing' and u.created_at >= date_trunc('month', now())), 0),
        'academic_agent', coalesce(sum(u.cost_usd) filter (where u.feature = 'academic_agent' and u.created_at >= date_trunc('month', now())), 0),
        'staff_assistant', coalesce(sum(u.cost_usd) filter (where u.feature = 'staff_assistant' and u.created_at >= date_trunc('month', now())), 0),
        'workflow_agent', coalesce(sum(u.cost_usd) filter (where u.feature = 'workflow_agent' and u.created_at >= date_trunc('month', now())), 0)
      ),
      'budgets', jsonb_build_object(
        'student_assistant', (select s.monthly_budget_usd from public.assistant_settings s where s.tenant_id = v_tenant),
        'admissions_agent', (select s.monthly_budget_usd from public.admissions_settings s where s.tenant_id = v_tenant),
        'academic_agent', (select s.monthly_budget_usd from public.academic_settings s where s.tenant_id = v_tenant),
        'staff_assistant', (select s.monthly_budget_usd from public.staff_assistant_settings s where s.tenant_id = v_tenant),
        'workflow_agent', (select s.monthly_budget_usd from public.workflow_settings s where s.tenant_id = v_tenant)
      ),
      'period', jsonb_build_object(
        'calls', count(*) filter (where u.created_at >= v_since),
        'cost_usd', coalesce(sum(u.cost_usd) filter (where u.created_at >= v_since), 0),
        'input_tokens', coalesce(sum(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) filter (where u.created_at >= v_since), 0),
        'output_tokens', coalesce(sum(u.output_tokens) filter (where u.created_at >= v_since), 0)
      )
    )
    into v_ai
    from public.ai_usage_events u
    where u.tenant_id = v_tenant and u.created_at >= least(v_since, date_trunc('month', now()));
  end if;

  -- Academic assistant (Phase 9): activity only, never individual students.
  if app.tenant_has_feature(v_tenant, 'academic_agent') then
    v_academic := app.academic_stats(v_tenant, v_since);
  end if;

  -- Service requests (Phase 11): counts only, never who asked.
  if app.tenant_has_feature(v_tenant, 'workflow_agent') then
    select jsonb_build_object(
      'submitted', count(*) filter (where r.created_at >= v_since),
      'from_assistant', count(*) filter (where r.created_at >= v_since and r.source = 'assistant'),
      'completed', count(*) filter (where r.status = 'completed' and r.closed_at >= v_since),
      'rejected', count(*) filter (where r.status = 'rejected' and r.closed_at >= v_since),
      'cancelled', count(*) filter (where r.status = 'cancelled' and r.closed_at >= v_since),
      'open_now', count(*) filter (where r.status in ('submitted', 'in_review', 'needs_info', 'approved')),
      'open_by_status', jsonb_build_object(
        'submitted', count(*) filter (where r.status = 'submitted'),
        'in_review', count(*) filter (where r.status = 'in_review'),
        'needs_info', count(*) filter (where r.status = 'needs_info'),
        'approved', count(*) filter (where r.status = 'approved')
      ),
      'median_completion_hours', round((percentile_cont(0.5) within group (order by extract(epoch from (r.closed_at - r.created_at)) / 3600)
        filter (where r.status = 'completed' and r.closed_at >= v_since))::numeric, 1),
      'by_form', coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'title_ar', d.title_ar, 'submitted', x.n) order by x.n desc, d.title)
        from (
          select w.definition_id, count(*) as n from public.workflow_requests w
          where w.tenant_id = v_tenant and w.created_at >= v_since
          group by w.definition_id order by count(*) desc limit 8
        ) x
        join public.workflow_definitions d on d.id = x.definition_id
      ), '[]'::jsonb)
    )
    into v_workflows
    from public.workflow_requests r
    where r.tenant_id = v_tenant;
  end if;

  if app.has_permission(v_tenant, 'quality.review') and (v_student or v_admissions) then
    v_quality := app.quality_counts(v_tenant, v_since);
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'days', p_days, 'from', v_first, 'to', v_today, 'since', v_since, 'timezone', v_tz,
      'bucket', case when v_step = 7 then 'week' else 'day' end
    ),
    'generated_at', now(),
    'members', jsonb_build_object(
      'active', (select count(*) from public.tenant_memberships tm where tm.tenant_id = v_tenant and tm.status = 'active')
    ),
    'assistant', v_assistant,
    'tickets', v_tickets,
    'admissions', v_leads,
    'knowledge', v_knowledge,
    'ai', v_ai,
    'quality', v_quality,
    'academic', v_academic,
    'workflows', v_workflows,
    'can', jsonb_build_object(
      'costs', app.has_permission(v_tenant, 'analytics.ai_costs.view'),
      'gaps', (v_student or v_admissions) and (app.has_permission(v_tenant, 'quality.review') or app.has_permission(v_tenant, 'knowledge.manage')),
      'review', (v_student or v_admissions) and app.has_permission(v_tenant, 'quality.review'),
      'advanced', app.tenant_has_feature(v_tenant, 'analytics_advanced')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.workflow_save_definition(text, uuid, text, text, text, text, text, uuid)',
    'public.workflow_save_draft(uuid, jsonb, text, text, text, text)',
    'public.workflow_publish(uuid)',
    'public.workflow_discard_draft(uuid)',
    'public.workflow_set_status(uuid, text)',
    'public.workflow_delete_definition(uuid)',
    'public.workflow_submit(text, uuid, uuid, jsonb, text)',
    'public.workflow_cancel(uuid)',
    'public.workflow_comment(uuid, text, boolean)',
    'public.workflow_update_status(uuid, text, text)',
    'public.workflow_assign(uuid, uuid)',
    'public.workflow_assignees(text, uuid)',
    'public.workflow_status(text)',
    'public.workflow_update_settings(text, boolean, numeric, integer)',
    'public.workflow_ai_begin(text)',
    'public.workflow_ai_record(text, text, jsonb)',
    'public.workflow_usage(text)',
    'public.my_notifications(text, integer)',
    'public.analytics_overview(text, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
