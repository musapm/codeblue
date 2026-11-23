-- UniAgent AI · Phase 7 · Migration 13: tickets and human handoff.
--
-- * Members with tickets.create open a request (from the portal or from the student assistant,
--   optionally sharing that conversation with staff). Categories route requests to a department
--   with a default priority.
-- * Staff queues: requesters see their own tickets; staff see their departments' tickets
--   (tickets.read_department), everything (tickets.read_all), or what is assigned to them.
-- * The public thread (ticket_messages) is shared with the requester. Internal notes are a
--   separate table that a requester never reads — not even a requester who is staff in that
--   department. AI summaries for staff are stored as internal notes.
-- * Tickets hold personal data: they are not copied into the append-only audit log (as for
--   admissions leads, ADR-026); their history is ticket_events.
-- * In-app notifications for new tickets in a queue, assignments, replies and resolutions.
-- * AI drafting (students) and summaries (staff) are booked as feature 'ticketing' and count
--   against the student assistant's monthly budget.

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create or replace function app.can_read_ticket(p_tenant uuid, p_requester uuid, p_department uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: these helpers are also used in PL/pgSQL "if not …" checks, where NULL must mean no.
  select coalesce(app.tenant_has_feature(p_tenant, 'ticketing') and (
    (p_requester = auth.uid() and app.has_permission(p_tenant, 'tickets.read_own'))
    or app.has_permission(p_tenant, 'tickets.read_all')
    or (p_department is not null and app.has_permission(p_tenant, 'tickets.read_department') and app.in_department(p_tenant, p_department))
    or (p_assignee = auth.uid() and app.has_permission(p_tenant, 'tickets.update'))
  ), false);
$$;

-- Staff who may work the ticket (reply as staff, change status, see the shared conversation).
create or replace function app.is_ticket_staff(p_tenant uuid, p_department uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.tenant_has_feature(p_tenant, 'ticketing') and app.has_permission(p_tenant, 'tickets.update') and (
    app.has_permission(p_tenant, 'tickets.read_all')
    or (p_department is not null and app.has_permission(p_tenant, 'tickets.read_department') and app.in_department(p_tenant, p_department))
    or p_assignee = auth.uid()
  ), false);
$$;

-- Internal notes: staff only, and never the requester (even when the requester is staff).
create or replace function app.can_read_ticket_notes(p_tenant uuid, p_requester uuid, p_department uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_requester <> auth.uid()
    and app.is_ticket_staff(p_tenant, p_department, p_assignee)
    and app.has_permission(p_tenant, 'tickets.notes.read'), false);
$$;

-- Active members who work a queue: tickets.update and (read_all, or a member of the department).
create or replace function app.ticket_queue_staff(p_tenant uuid, p_department uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.user_id
  from public.tenant_memberships m
  where m.tenant_id = p_tenant and m.status = 'active'
    and app.member_has_any_permission(p_tenant, m.user_id, array['tickets.update'])
    and (
      app.member_has_any_permission(p_tenant, m.user_id, array['tickets.read_all'])
      or (p_department is not null
          and app.member_has_any_permission(p_tenant, m.user_id, array['tickets.read_department'])
          and exists (select 1 from public.membership_departments md where md.membership_id = m.id and md.department_id = p_department))
    );
$$;

create or replace function app.display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.full_name), ''), u.email, 'Member')
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = p_user;
$$;

revoke all on function app.can_read_ticket(uuid, uuid, uuid, uuid), app.is_ticket_staff(uuid, uuid, uuid),
  app.can_read_ticket_notes(uuid, uuid, uuid, uuid), app.ticket_queue_staff(uuid, uuid), app.display_name(uuid) from public;
-- Used inside RLS policies, so the API roles must be able to call the three access checks.
grant execute on function app.can_read_ticket(uuid, uuid, uuid, uuid), app.is_ticket_staff(uuid, uuid, uuid),
  app.can_read_ticket_notes(uuid, uuid, uuid, uuid) to authenticated, service_role;

-- Student-support AI budget now covers the assistant and AI help with tickets.
create or replace function app.assistant_month_cost(p_tenant uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select app.ai_month_cost(p_tenant, 'student_assistant') + app.ai_month_cost(p_tenant, 'ticketing');
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null constraint ticket_categories_name check (char_length(btrim(name)) between 2 and 80),
  name_ar text constraint ticket_categories_name_ar check (name_ar is null or char_length(name_ar) <= 80),
  -- Routing rule: requests in this category go to this department's queue.
  department_id uuid,
  default_priority text not null default 'normal'
    constraint ticket_categories_priority check (default_priority in ('low', 'normal', 'high', 'urgent')),
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reference text not null constraint tickets_reference check (reference ~ '^T-[0-9]{5,}$'),
  subject text not null constraint tickets_subject check (char_length(btrim(subject)) between 3 and 200),
  category_id uuid,
  department_id uuid,
  priority text not null default 'normal' constraint tickets_priority check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' constraint tickets_status check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  source text not null constraint tickets_source check (source in ('portal', 'assistant')),
  requester_id uuid not null references auth.users (id) on delete cascade,
  -- Snapshot so staff without members.read still see who asked.
  requester_name text not null constraint tickets_requester_name check (char_length(requester_name) between 1 and 254),
  assignee_id uuid references auth.users (id) on delete set null,
  -- Assistant conversation the requester chose to share with staff.
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (tenant_id, reference),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references public.ticket_categories (tenant_id, id) on delete set null (category_id),
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.assistant_conversations (tenant_id, id) on delete set null (conversation_id)
);
create index tickets_tenant_status_idx on public.tickets (tenant_id, status, last_activity_at desc);
create index tickets_department_idx on public.tickets (tenant_id, department_id, status);
create index tickets_requester_idx on public.tickets (requester_id, created_at desc);
create index tickets_assignee_idx on public.tickets (assignee_id, status);

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null constraint ticket_messages_author check (char_length(author_name) between 1 and 254),
  from_staff boolean not null,
  body text not null constraint ticket_messages_body check (char_length(btrim(body)) between 1 and 8000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, ticket_id) references public.tickets (tenant_id, id) on delete cascade
);
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

create table public.ticket_internal_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null constraint ticket_notes_author check (char_length(author_name) between 1 and 254),
  kind text not null default 'note' constraint ticket_notes_kind check (kind in ('note', 'ai_summary')),
  model text constraint ticket_notes_model check (model is null or model ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'),
  body text not null constraint ticket_notes_body check (char_length(btrim(body)) between 1 and 8000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, ticket_id) references public.tickets (tenant_id, id) on delete cascade
);
create index ticket_notes_ticket_idx on public.ticket_internal_notes (ticket_id, created_at);

create table public.ticket_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  ticket_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null constraint ticket_events_kind check (kind in ('created', 'status', 'priority', 'department', 'category', 'assigned')),
  from_value text constraint ticket_events_from check (from_value is null or char_length(from_value) <= 200),
  to_value text constraint ticket_events_to check (to_value is null or char_length(to_value) <= 200),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, ticket_id) references public.tickets (tenant_id, id) on delete cascade
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

create table public.notifications (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null constraint notifications_kind check (kind in ('ticket_new', 'ticket_assigned', 'ticket_reply', 'ticket_status')),
  ticket_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (tenant_id, ticket_id) references public.tickets (tenant_id, id) on delete cascade
);
create index notifications_user_idx on public.notifications (user_id, tenant_id, created_at desc);

create table app.ticket_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number integer not null default 0
);
alter table app.ticket_counters enable row level security;
revoke all on table app.ticket_counters from public;

create trigger ticket_categories_updated_at before update on public.ticket_categories
  for each row execute function app.set_updated_at();
create trigger tickets_updated_at before update on public.tickets
  for each row execute function app.set_updated_at();
-- Categories are configuration (no personal data): audited by the generic trigger.
create trigger ticket_categories_audit after insert or update or delete on public.ticket_categories
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ticket_categories enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_internal_notes enable row level security;
alter table public.ticket_events enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.ticket_categories, public.tickets, public.ticket_messages, public.ticket_internal_notes,
  public.ticket_events, public.notifications from anon, authenticated;
grant select on table public.ticket_categories, public.tickets, public.ticket_messages, public.ticket_internal_notes,
  public.ticket_events, public.notifications to authenticated;
grant insert, update, delete on table public.ticket_categories to authenticated;

create policy ticket_categories_select on public.ticket_categories for select to authenticated
  using (app.is_tenant_member(tenant_id) and app.tenant_has_feature(tenant_id, 'ticketing'));
create policy ticket_categories_insert on public.ticket_categories for insert to authenticated
  with check (app.has_permission(tenant_id, 'departments.manage') and app.tenant_has_feature(tenant_id, 'ticketing'));
create policy ticket_categories_update on public.ticket_categories for update to authenticated
  using (app.has_permission(tenant_id, 'departments.manage') and app.tenant_has_feature(tenant_id, 'ticketing'))
  with check (app.has_permission(tenant_id, 'departments.manage') and app.tenant_has_feature(tenant_id, 'ticketing'));
create policy ticket_categories_delete on public.ticket_categories for delete to authenticated
  using (app.has_permission(tenant_id, 'departments.manage') and app.tenant_has_feature(tenant_id, 'ticketing'));

create policy tickets_select on public.tickets for select to authenticated
  using (app.can_read_ticket(tenant_id, requester_id, department_id, assignee_id));
create policy ticket_messages_select on public.ticket_messages for select to authenticated
  using (exists (
    select 1 from public.tickets t
    where t.id = ticket_id and app.can_read_ticket(t.tenant_id, t.requester_id, t.department_id, t.assignee_id)
  ));
create policy ticket_internal_notes_select on public.ticket_internal_notes for select to authenticated
  using (exists (
    select 1 from public.tickets t
    where t.id = ticket_id and app.can_read_ticket_notes(t.tenant_id, t.requester_id, t.department_id, t.assignee_id)
  ));
create policy ticket_events_select on public.ticket_events for select to authenticated
  using (exists (
    select 1 from public.tickets t
    where t.id = ticket_id and app.is_ticket_staff(t.tenant_id, t.department_id, t.assignee_id)
  ));
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and app.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- Internal helpers for the API
-- ---------------------------------------------------------------------------

create or replace function app.next_ticket_reference(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into app.ticket_counters as c (tenant_id, last_number) values (p_tenant, 1)
  on conflict (tenant_id) do update set last_number = c.last_number + 1
  returning last_number into v_n;
  return 'T-' || lpad(v_n::text, 5, '0');
end;
$$;

create or replace function app.notify(p_tenant uuid, p_users uuid[], p_kind text, p_ticket uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (tenant_id, user_id, kind, ticket_id)
  select p_tenant, u, p_kind, p_ticket
  from (select distinct unnest(p_users) as u) x
  where u is not null and u is distinct from auth.uid();
$$;

revoke all on function app.next_ticket_reference(uuid), app.notify(uuid, uuid[], text, uuid) from public;

-- ---------------------------------------------------------------------------
-- API: requesters
-- ---------------------------------------------------------------------------

-- Open a request. Routing: the category's department and default priority. At most 10 new
-- requests per person per day.
create or replace function public.tickets_create(
  p_tenant_slug text,
  p_subject text,
  p_body text,
  p_category uuid,
  p_conversation uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  c public.ticket_categories;
  v_ticket uuid;
  v_reference text;
  v_name text;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tickets.create') or not app.tenant_has_feature(v_tenant, 'ticketing') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (select count(*) from public.tickets t where t.tenant_id = v_tenant and t.requester_id = auth.uid() and t.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'too many requests today' using errcode = '54000';
  end if;
  if p_category is not null then
    select * into c from public.ticket_categories where id = p_category and tenant_id = v_tenant and active;
    if c.id is null then
      raise exception 'category not found' using errcode = '22023';
    end if;
  end if;
  if p_conversation is not null and not exists (
    select 1 from public.assistant_conversations ac
    where ac.id = p_conversation and ac.tenant_id = v_tenant and ac.user_id = auth.uid() and ac.agent = 'student'
  ) then
    raise exception 'conversation not found' using errcode = '22023';
  end if;

  v_reference := app.next_ticket_reference(v_tenant);
  v_name := app.display_name(auth.uid());
  insert into public.tickets (tenant_id, reference, subject, category_id, department_id, priority, source, requester_id, requester_name, conversation_id)
  values (v_tenant, v_reference, btrim(p_subject), c.id, c.department_id, coalesce(c.default_priority, 'normal'),
          case when p_conversation is null then 'portal' else 'assistant' end, auth.uid(), v_name, p_conversation)
  returning id into v_ticket;
  insert into public.ticket_messages (tenant_id, ticket_id, author_id, author_name, from_staff, body)
  values (v_tenant, v_ticket, auth.uid(), v_name, false, btrim(p_body));
  insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, to_value)
  values (v_tenant, v_ticket, auth.uid(), 'created', case when p_conversation is null then 'portal' else 'assistant' end);
  perform app.notify(v_tenant, array(select app.ticket_queue_staff(v_tenant, c.department_id)), 'ticket_new', v_ticket);
  return jsonb_build_object('id', v_ticket, 'reference', v_reference);
end;
$$;

-- Reply on the public thread: the requester, or staff who work the ticket.
create or replace function public.tickets_reply(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  v_staff boolean;
  v_message uuid;
  v_status text;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null or not app.can_read_ticket(t.tenant_id, t.requester_id, t.department_id, t.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- On their own ticket a person always speaks as the requester.
  v_staff := t.requester_id <> auth.uid() and app.is_ticket_staff(t.tenant_id, t.department_id, t.assignee_id);
  if not v_staff and t.requester_id is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if t.status = 'closed' then
    raise exception 'ticket is closed' using errcode = '55000';
  end if;

  insert into public.ticket_messages (tenant_id, ticket_id, author_id, author_name, from_staff, body)
  values (t.tenant_id, t.id, auth.uid(), app.display_name(auth.uid()), v_staff, btrim(p_body))
  returning id into v_message;

  v_status := case
    when v_staff and t.status = 'open' then 'in_progress'
    when not v_staff and t.status in ('waiting', 'resolved') then 'open'
    else t.status end;
  update public.tickets
  set status = v_status,
      last_activity_at = now(),
      first_response_at = case when v_staff then coalesce(first_response_at, now()) else first_response_at end,
      resolved_at = case when v_status = 'resolved' then resolved_at else null end
  where id = t.id;
  if v_status <> t.status then
    insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, from_value, to_value)
    values (t.tenant_id, t.id, auth.uid(), 'status', t.status, v_status);
  end if;

  if v_staff then
    perform app.notify(t.tenant_id, array[t.requester_id], 'ticket_reply', t.id);
  elsif t.assignee_id is not null then
    perform app.notify(t.tenant_id, array[t.assignee_id], 'ticket_reply', t.id);
  else
    perform app.notify(t.tenant_id, array(select app.ticket_queue_staff(t.tenant_id, t.department_id)), 'ticket_reply', t.id);
  end if;
  return v_message;
end;
$$;

-- The requester closes their own request.
create or replace function public.tickets_close(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null or t.requester_id is distinct from auth.uid() or not app.can_read_ticket(t.tenant_id, t.requester_id, t.department_id, t.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if t.status = 'closed' then
    return;
  end if;
  update public.tickets set status = 'closed', closed_at = now(), last_activity_at = now() where id = t.id;
  insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, from_value, to_value)
  values (t.tenant_id, t.id, auth.uid(), 'status', t.status, 'closed');
  if t.assignee_id is not null then
    perform app.notify(t.tenant_id, array[t.assignee_id], 'ticket_status', t.id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- API: staff
-- ---------------------------------------------------------------------------

-- Change status, priority, category, department (transfer) and assignee. Transfers and assigning
-- someone else need tickets.assign; taking a ticket yourself (or letting it go) needs
-- tickets.update. Every change is logged and the people concerned are notified.
create or replace function public.tickets_update(
  p_ticket uuid,
  p_status text,
  p_priority text,
  p_category uuid,
  p_department uuid,
  p_assignee uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  v_can_assign boolean;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null or t.requester_id is not distinct from auth.uid() or not app.is_ticket_staff(t.tenant_id, t.department_id, t.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_can_assign := app.has_permission(t.tenant_id, 'tickets.assign');
  if p_department is distinct from t.department_id and not v_can_assign then
    raise exception 'transfers need tickets.assign' using errcode = '42501';
  end if;
  if p_assignee is distinct from t.assignee_id and not v_can_assign
     and not (p_assignee is not distinct from auth.uid() or (p_assignee is null and t.assignee_id is not distinct from auth.uid())) then
    raise exception 'assigning others needs tickets.assign' using errcode = '42501';
  end if;
  if p_department is not null and not exists (select 1 from public.departments d where d.id = p_department and d.tenant_id = t.tenant_id) then
    raise exception 'department not found' using errcode = '22023';
  end if;
  if p_category is not null and not exists (select 1 from public.ticket_categories c where c.id = p_category and c.tenant_id = t.tenant_id) then
    raise exception 'category not found' using errcode = '22023';
  end if;
  if p_assignee is not null and p_assignee is distinct from t.assignee_id
     and p_assignee not in (select app.ticket_queue_staff(t.tenant_id, p_department)) then
    raise exception 'assignee does not work this queue' using errcode = '22023';
  end if;

  update public.tickets
  set status = p_status,
      priority = p_priority,
      category_id = p_category,
      department_id = p_department,
      assignee_id = p_assignee,
      last_activity_at = now(),
      resolved_at = case when p_status = 'resolved' then coalesce(t.resolved_at, now()) when p_status = 'closed' then t.resolved_at else null end,
      closed_at = case when p_status = 'closed' then coalesce(t.closed_at, now()) else null end
  where id = t.id;

  if t.status is distinct from p_status then
    insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, from_value, to_value) values (t.tenant_id, t.id, auth.uid(), 'status', t.status, p_status);
    if p_status in ('resolved', 'closed', 'waiting') then
      perform app.notify(t.tenant_id, array[t.requester_id], 'ticket_status', t.id);
    end if;
  end if;
  if t.priority is distinct from p_priority then
    insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, from_value, to_value) values (t.tenant_id, t.id, auth.uid(), 'priority', t.priority, p_priority);
  end if;
  if t.category_id is distinct from p_category then
    insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, from_value, to_value) values (t.tenant_id, t.id, auth.uid(), 'category', t.category_id::text, p_category::text);
  end if;
  if t.department_id is distinct from p_department then
    insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, from_value, to_value) values (t.tenant_id, t.id, auth.uid(), 'department', t.department_id::text, p_department::text);
    perform app.notify(t.tenant_id, array(select app.ticket_queue_staff(t.tenant_id, p_department)), 'ticket_new', t.id);
  end if;
  if t.assignee_id is distinct from p_assignee then
    insert into public.ticket_events (tenant_id, ticket_id, actor_id, kind, from_value, to_value) values (t.tenant_id, t.id, auth.uid(), 'assigned', t.assignee_id::text, p_assignee::text);
    perform app.notify(t.tenant_id, array[p_assignee], 'ticket_assigned', t.id);
  end if;
end;
$$;

create or replace function public.tickets_add_note(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  v_note uuid;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null or not app.can_read_ticket_notes(t.tenant_id, t.requester_id, t.department_id, t.assignee_id)
     or not app.has_permission(t.tenant_id, 'tickets.notes.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.ticket_internal_notes (tenant_id, ticket_id, author_id, author_name, body)
  values (t.tenant_id, t.id, auth.uid(), app.display_name(auth.uid()), btrim(p_body))
  returning id into v_note;
  return v_note;
end;
$$;

-- The conversation the requester shared, for staff who work the ticket.
create or replace function public.tickets_shared_conversation(p_ticket uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null or t.requester_id is not distinct from auth.uid() or not app.is_ticket_staff(t.tenant_id, t.department_id, t.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if t.conversation_id is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content, 'status', m.status, 'citations', m.citations, 'created_at', m.created_at) order by m.created_at)
    from public.assistant_messages m
    where m.conversation_id = t.conversation_id and m.created_at <= t.created_at
  ), '[]'::jsonb);
end;
$$;

-- People a ticket can be assigned to: those who work the given department's queue.
create or replace function public.tickets_assignees(p_tenant_slug text, p_department uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'tickets.update') or not app.tenant_has_feature(v_tenant, 'ticketing') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', s.id, 'name', app.display_name(s.id)) order by app.display_name(s.id))
    from app.ticket_queue_staff(v_tenant, p_department) as s (id)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- API: AI help (student drafts, staff summaries)
-- ---------------------------------------------------------------------------

-- Before an AI call: the person may use ticketing, the university has an AI budget left, and
-- they have not reached 30 AI calls for tickets today.
create or replace function public.tickets_ai_begin(p_tenant_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.assistant_settings;
begin
  if v_tenant is null or not app.tenant_has_feature(v_tenant, 'ticketing')
     or not (app.has_permission(v_tenant, 'tickets.create') or app.has_permission(v_tenant, 'tickets.update')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.assistant_settings where tenant_id = v_tenant;
  if s.tenant_id is null or app.assistant_month_cost(v_tenant) >= s.monthly_budget_usd then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if (select count(*) from public.ai_usage_events u
      where u.tenant_id = v_tenant and u.user_id = auth.uid() and u.feature = 'ticketing' and u.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily AI limit reached' using errcode = '54000';
  end if;
end;
$$;

create or replace function public.tickets_ai_record(p_tenant_slug text, p_model text, p_usage jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.tenant_has_feature(v_tenant, 'ticketing')
     or not (app.has_permission(v_tenant, 'tickets.create') or app.has_permission(v_tenant, 'tickets.update')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.ai_usage_events (tenant_id, user_id, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
  values (v_tenant, auth.uid(), 'ticketing', p_model,
          coalesce((p_usage ->> 'input_tokens')::integer, 0), coalesce((p_usage ->> 'output_tokens')::integer, 0),
          coalesce((p_usage ->> 'cache_read_tokens')::integer, 0), coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
          coalesce((p_usage ->> 'cost_usd')::numeric, 0));
end;
$$;

-- An AI summary for staff, stored as an internal note (never shown to the requester).
create or replace function public.tickets_add_ai_summary(p_ticket uuid, p_summary text, p_model text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  v_note uuid;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null or not app.can_read_ticket_notes(t.tenant_id, t.requester_id, t.department_id, t.assignee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.ticket_internal_notes (tenant_id, ticket_id, author_id, author_name, kind, model, body)
  values (t.tenant_id, t.id, auth.uid(), app.display_name(auth.uid()), 'ai_summary', p_model, btrim(p_summary))
  returning id into v_note;
  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- API: notifications
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
      select jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'created_at', n.created_at, 'read', n.read_at is not null,
        'ticket_id', t.id, 'reference', t.reference, 'subject', t.subject,
        'mine', t.requester_id = auth.uid()
      ) as x
      from public.notifications n
      join public.tickets t on t.id = n.ticket_id
      where n.user_id = auth.uid() and n.tenant_id = v_tenant
        and app.can_read_ticket(t.tenant_id, t.requester_id, t.department_id, t.assignee_id)
      order by n.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) q
  ), '[]'::jsonb);
end;
$$;

create or replace function public.notifications_mark_read(p_tenant_slug text, p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_count integer;
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.notifications n
  set read_at = now()
  where n.user_id = auth.uid() and n.tenant_id = v_tenant and n.read_at is null
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Student-support usage summary: the assistant plus AI help with tickets (one budget).
create or replace function public.assistant_usage_summary(p_tenant_slug text)
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
  return (
    with msgs as (
      select m.role, m.status from public.assistant_messages m
      join public.assistant_conversations c on c.id = m.conversation_id
      where m.tenant_id = v_tenant and c.agent = 'student' and m.created_at >= v_since
    ),
    fb as (
      select f.rating from public.assistant_feedback f
      join public.assistant_messages m on m.id = f.message_id
      join public.assistant_conversations c on c.id = m.conversation_id
      where f.tenant_id = v_tenant and c.agent = 'student' and f.created_at >= v_since
    ),
    ev as (
      select * from public.ai_usage_events u
      where u.tenant_id = v_tenant and u.feature in ('student_assistant', 'ticketing') and u.created_at >= v_since
    )
    select jsonb_build_object(
      'since', v_since,
      'questions', (select count(*) from msgs where role = 'user'),
      'answered', (select count(*) from msgs where status = 'answered'),
      'no_sources', (select count(*) from msgs where status = 'no_sources'),
      'refused', (select count(*) from msgs where status = 'refused'),
      'errors', (select count(*) from msgs where status = 'error'),
      'helpful', (select count(*) from fb where rating = 1),
      'not_helpful', (select count(*) from fb where rating = -1),
      'input_tokens', (select coalesce(sum(input_tokens + cache_read_tokens + cache_write_tokens), 0) from ev),
      'output_tokens', (select coalesce(sum(output_tokens), 0) from ev),
      'cost_usd', app.assistant_month_cost(v_tenant)
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
    'public.tickets_create(text, text, text, uuid, uuid)',
    'public.tickets_reply(uuid, text)',
    'public.tickets_close(uuid)',
    'public.tickets_update(uuid, text, text, uuid, uuid, uuid)',
    'public.tickets_add_note(uuid, text)',
    'public.tickets_shared_conversation(uuid)',
    'public.tickets_assignees(text, uuid)',
    'public.tickets_ai_begin(text)',
    'public.tickets_ai_record(text, text, jsonb)',
    'public.tickets_add_ai_summary(uuid, text, text)',
    'public.my_notifications(text, integer)',
    'public.notifications_mark_read(text, bigint[])'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
