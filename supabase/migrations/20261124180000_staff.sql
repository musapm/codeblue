-- UniAgent AI · Phase 10 · Migration 16: staff assistant.
--
-- * Staff (assistant.staff.use, feature staff_assistant) ask questions over the documents they
--   may read, optionally only one department's documents. Same grounded pipeline as the student
--   assistant; conversations with agent 'staff', private to their author.
-- * Drafting tools: emails, letters and announcements grounded in those documents. Drafts are
--   kept privately for their author and are never sent by the AI.
-- * Ticket summaries: a digest of the open tickets the person works (their own queues and
--   assignments), never other departments' tickets and never their own requests.
-- * Its own monthly budget and a daily limit per person (staff_assistant_settings), switched on
--   and configured with assistant.configure. Usage is booked as feature 'staff_assistant'.
-- * Staff conversations are not part of the AI quality review (internal questions); their
--   figures appear in analytics.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.assistant_conversations drop constraint assistant_conversations_agent;
alter table public.assistant_conversations
  add constraint assistant_conversations_agent check (agent in ('student', 'admissions', 'staff'));

create table public.staff_assistant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  instructions text constraint staff_settings_instructions check (instructions is null or char_length(instructions) <= 2000),
  monthly_budget_usd numeric(10, 2) not null default 20
    constraint staff_settings_budget check (monthly_budget_usd >= 0 and monthly_budget_usd <= 100000),
  daily_limit integer not null default 60 constraint staff_settings_daily_limit check (daily_limit between 1 and 500),
  updated_at timestamptz not null default now()
);

create table public.staff_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null constraint staff_drafts_kind check (kind in ('email', 'letter', 'announcement')),
  title text not null constraint staff_drafts_title check (char_length(btrim(title)) between 1 and 200),
  language text not null constraint staff_drafts_language check (language in ('en', 'ar')),
  -- {subject, body, missing: [details the author must add]}. coalesce: a CHECK that evaluates to
  -- NULL passes, so a missing body must compare as false (found by the tests).
  content jsonb not null constraint staff_drafts_content check (
    jsonb_typeof(content) = 'object' and coalesce(jsonb_typeof(content -> 'body'), '') = 'string' and pg_column_size(content) <= 131072
  ),
  -- The documents it drew on: [{document_id, version_no, title, title_ar}].
  sources jsonb not null default '[]'::jsonb constraint staff_drafts_sources check (jsonb_typeof(sources) = 'array'),
  model text not null constraint staff_drafts_model check (model ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index staff_drafts_owner_idx on public.staff_drafts (user_id, tenant_id, created_at desc);

create trigger staff_assistant_settings_updated_at before update on public.staff_assistant_settings
  for each row execute function app.set_updated_at();
-- Settings are configuration: audited. Drafts are the author's own work: not audited.
create trigger staff_assistant_settings_audit after insert or update or delete on public.staff_assistant_settings
  for each row execute function app.audit_row_change();

alter table public.staff_assistant_settings enable row level security;
alter table public.staff_drafts enable row level security;
revoke all on table public.staff_assistant_settings, public.staff_drafts from anon, authenticated;
grant select on table public.staff_assistant_settings, public.staff_drafts to authenticated;
create policy staff_settings_select on public.staff_assistant_settings for select to authenticated
  using (app.has_permission(tenant_id, 'assistant.configure'));
create policy staff_drafts_select on public.staff_drafts for select to authenticated
  using (user_id = auth.uid() and app.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The staff assistant's gate for one model call: permission, feature, switch, budget, daily limit.
-- Returns the settings row (raises otherwise).
create or replace function app.staff_gate(p_tenant uuid)
returns public.staff_assistant_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.staff_assistant_settings;
begin
  if p_tenant is null or not app.has_permission(p_tenant, 'assistant.staff.use') or not app.tenant_has_feature(p_tenant, 'staff_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.staff_assistant_settings where tenant_id = p_tenant;
  if s.tenant_id is null or not s.enabled then
    raise exception 'staff assistant is turned off' using errcode = '55000';
  end if;
  if app.ai_month_cost(p_tenant, 'staff_assistant') >= s.monthly_budget_usd then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if (select count(*) from public.ai_usage_events u
      where u.tenant_id = p_tenant and u.user_id = auth.uid() and u.feature = 'staff_assistant' and u.created_at > now() - interval '24 hours')
     >= s.daily_limit then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;
  return s;
end;
$$;

create or replace function app.staff_record_usage(p_tenant uuid, p_model text, p_usage jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage_events (tenant_id, user_id, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
  values (p_tenant, auth.uid(), 'staff_assistant', p_model,
          coalesce((p_usage ->> 'input_tokens')::integer, 0), coalesce((p_usage ->> 'output_tokens')::integer, 0),
          coalesce((p_usage ->> 'cache_read_tokens')::integer, 0), coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
          coalesce((p_usage ->> 'cost_usd')::numeric, 0));
$$;

revoke all on function app.staff_gate(uuid), app.staff_record_usage(uuid, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- API: settings and status
-- ---------------------------------------------------------------------------

create or replace function public.staff_assistant_status(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.staff_assistant_settings;
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.staff_assistant_settings where tenant_id = v_tenant;
  return jsonb_build_object(
    'can_use', app.has_permission(v_tenant, 'assistant.staff.use'),
    'feature', app.tenant_has_feature(v_tenant, 'staff_assistant'),
    'enabled', coalesce(s.enabled, false),
    'within_budget', s.tenant_id is not null and app.ai_month_cost(v_tenant, 'staff_assistant') < s.monthly_budget_usd,
    'can_digest', app.tenant_has_feature(v_tenant, 'ticketing')
      and (app.has_permission(v_tenant, 'tickets.read_department') or app.has_permission(v_tenant, 'tickets.read_all'))
  );
end;
$$;

create or replace function public.staff_assistant_update_settings(
  p_tenant_slug text,
  p_enabled boolean,
  p_instructions text,
  p_monthly_budget_usd numeric,
  p_daily_limit integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.configure') or not app.tenant_has_feature(v_tenant, 'staff_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.staff_assistant_settings (tenant_id, enabled, instructions, monthly_budget_usd, daily_limit)
  values (v_tenant, coalesce(p_enabled, false), nullif(btrim(p_instructions), ''), p_monthly_budget_usd, p_daily_limit)
  on conflict (tenant_id) do update
    set enabled = excluded.enabled, instructions = excluded.instructions,
        monthly_budget_usd = excluded.monthly_budget_usd, daily_limit = excluded.daily_limit;
end;
$$;

-- Month figures for the settings page.
create or replace function public.staff_assistant_usage(p_tenant_slug text)
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
    'questions', (select count(*) from public.assistant_messages m join public.assistant_conversations c on c.id = m.conversation_id
                  where m.tenant_id = v_tenant and c.agent = 'staff' and m.role = 'user' and m.created_at >= v_since),
    'drafts', (select count(*) from public.staff_drafts d where d.tenant_id = v_tenant and d.created_at >= v_since),
    'people', (select count(distinct u.user_id) from public.ai_usage_events u where u.tenant_id = v_tenant and u.feature = 'staff_assistant' and u.created_at >= v_since),
    'cost_usd', app.ai_month_cost(v_tenant, 'staff_assistant')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- API: questions (the shared answer pipeline)
-- ---------------------------------------------------------------------------

create or replace function public.staff_begin_turn(p_tenant_slug text, p_conversation uuid, p_question text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_conversation uuid := p_conversation;
  v_question text := btrim(coalesce(p_question, ''));
  s public.staff_assistant_settings;
  v_history jsonb := '[]'::jsonb;
  v_message uuid;
begin
  s := app.staff_gate(v_tenant);
  if char_length(v_question) < 2 or char_length(v_question) > 2000 then
    raise exception 'invalid question' using errcode = '22023';
  end if;
  if v_conversation is null then
    insert into public.assistant_conversations (tenant_id, user_id, title, agent)
    values (v_tenant, auth.uid(), left(regexp_replace(v_question, '\s+', ' ', 'g'), 120), 'staff')
    returning id into v_conversation;
  else
    if not exists (
      select 1 from public.assistant_conversations c
      where c.id = v_conversation and c.tenant_id = v_tenant and c.user_id = auth.uid() and c.agent = 'staff'
    ) then
      raise exception 'conversation not found' using errcode = 'P0002';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content) order by m.created_at), '[]'::jsonb)
    into v_history
    from (
      select m.role, m.content, m.created_at
      from public.assistant_messages m
      where m.conversation_id = v_conversation and m.status in ('question', 'answered')
      order by m.created_at desc
      limit 10
    ) m;
    update public.assistant_conversations set updated_at = now() where id = v_conversation;
  end if;

  insert into public.assistant_messages (tenant_id, conversation_id, role, content, status)
  values (v_tenant, v_conversation, 'user', v_question, 'question')
  returning id into v_message;

  return jsonb_build_object(
    'conversation_id', v_conversation,
    'question_id', v_message,
    'history', v_history,
    'instructions', s.instructions,
    'support_email', null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- API: drafting tools and ticket summaries
-- ---------------------------------------------------------------------------

-- Before a draft or a ticket digest: the gate, and for digests access to ticket queues.
create or replace function public.staff_ai_begin(p_tenant_slug text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.staff_assistant_settings;
begin
  s := app.staff_gate(v_tenant);
  if p_kind is null or p_kind not in ('draft', 'digest') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_kind = 'digest' and not (
    app.tenant_has_feature(v_tenant, 'ticketing')
    and (app.has_permission(v_tenant, 'tickets.read_department') or app.has_permission(v_tenant, 'tickets.read_all'))
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('instructions', s.instructions);
end;
$$;

create or replace function public.staff_save_draft(
  p_tenant_slug text,
  p_kind text,
  p_title text,
  p_language text,
  p_content jsonb,
  p_sources jsonb,
  p_model text,
  p_usage jsonb
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
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.staff.use') or not app.tenant_has_feature(v_tenant, 'staff_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) > 10 then
    raise exception 'invalid sources' using errcode = '22023';
  end if;
  insert into public.staff_drafts (tenant_id, user_id, kind, title, language, content, sources, model)
  values (v_tenant, auth.uid(), p_kind, btrim(p_title), p_language, p_content, p_sources, p_model)
  returning id into v_id;
  perform app.staff_record_usage(v_tenant, p_model, p_usage);
  return v_id;
end;
$$;

-- Book usage of a call that produced nothing to keep (digests are not stored; refusals).
create or replace function public.staff_record_usage(p_tenant_slug text, p_model text, p_usage jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.staff.use') or not app.tenant_has_feature(v_tenant, 'staff_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform app.staff_record_usage(v_tenant, p_model, p_usage);
end;
$$;

create or replace function public.staff_delete_draft(p_draft uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.staff_drafts d where d.id = p_draft and d.user_id = auth.uid();
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;

-- The open tickets a digest may cover: only tickets the caller works as staff (not their own
-- requests), in the chosen scope. Minimal fields: no requester names, no internal notes.
--   mine: assigned to me · department: my departments (or one of them) · all: needs tickets.read_all
create or replace function public.staff_ticket_digest_source(p_tenant_slug text, p_scope text, p_department uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_rows jsonb;
  v_total integer;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.staff.use') or not app.tenant_has_feature(v_tenant, 'staff_assistant')
     or not app.tenant_has_feature(v_tenant, 'ticketing')
     or not (app.has_permission(v_tenant, 'tickets.read_department') or app.has_permission(v_tenant, 'tickets.read_all')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('mine', 'department', 'all') or (p_scope = 'all' and not app.has_permission(v_tenant, 'tickets.read_all'))
     or (p_department is not null and p_scope <> 'department') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;

  with t as (
    select tk.*
    from public.tickets tk
    where tk.tenant_id = v_tenant
      and tk.status in ('open', 'in_progress', 'waiting')
      and tk.requester_id <> auth.uid()
      and app.is_ticket_staff(tk.tenant_id, tk.department_id, tk.assignee_id)
      and case p_scope
            when 'mine' then tk.assignee_id = auth.uid()
            when 'department' then tk.department_id is not null and app.in_department(v_tenant, tk.department_id)
              and (p_department is null or tk.department_id = p_department)
            else true
          end
  )
  select count(*) into v_total from t;

  with t as (
    select tk.*
    from public.tickets tk
    where tk.tenant_id = v_tenant
      and tk.status in ('open', 'in_progress', 'waiting')
      and tk.requester_id <> auth.uid()
      and app.is_ticket_staff(tk.tenant_id, tk.department_id, tk.assignee_id)
      and case p_scope
            when 'mine' then tk.assignee_id = auth.uid()
            when 'department' then tk.department_id is not null and app.in_department(v_tenant, tk.department_id)
              and (p_department is null or tk.department_id = p_department)
            else true
          end
    order by case tk.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, tk.last_activity_at
    limit 60
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'reference', t.reference,
    'subject', t.subject,
    'status', t.status,
    'priority', t.priority,
    'category', (select k.name from public.ticket_categories k where k.id = t.category_id),
    'department', (select d.name from public.departments d where d.id = t.department_id),
    'assigned', t.assignee_id is not null,
    'assigned_to_me', t.assignee_id = auth.uid(),
    'created_at', t.created_at,
    'last_activity_at', t.last_activity_at,
    'first_message', (select left(m.body, 800) from public.ticket_messages m where m.ticket_id = t.id order by m.created_at limit 1),
    'last_message', (
      select jsonb_build_object('from_staff', m.from_staff, 'body', left(m.body, 400))
      from public.ticket_messages m where m.ticket_id = t.id order by m.created_at desc limit 1
    )
  ) order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.last_activity_at), '[]'::jsonb)
  into v_rows
  from t;

  return jsonb_build_object('total', v_total, 'tickets', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Retrieval with an optional department: only that department's documents (still only the
-- ones the caller may read). Same function otherwise; the old signature is replaced.
-- ---------------------------------------------------------------------------

drop function public.search_knowledge(text, text, integer, extensions.vector, text);

create or replace function public.search_knowledge(
  p_tenant_slug text,
  p_query text,
  p_limit integer default 8,
  p_embedding extensions.vector default null,
  p_embedding_model text default null,
  p_department uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_query tsquery := app.knowledge_tsquery(p_query);
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_query is null and p_embedding is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with readable as (
      select d.id, d.title, d.title_ar, d.is_authoritative, d.source_priority, d.effective_date, d.source_url, d.visibility, d.current_version_id
      from public.knowledge_documents d
      where d.tenant_id = v_tenant
        and d.published_at is not null
        and d.current_version_id is not null
        and d.archived_at is null
        and d.course_id is null
        and (p_department is null or d.department_id = p_department)
        and (d.expiry_date is null or d.expiry_date >= current_date)
        and app.can_read_knowledge(v_tenant, d.id)
    ),
    fts as (
      select c.id, row_number() over (order by ts_rank_cd(c.search_tsv, v_query, 1) desc, c.id) as rn
      from public.knowledge_chunks c
      join readable r on r.id = c.document_id and r.current_version_id = c.version_id
      where v_query is not null and c.tenant_id = v_tenant and c.search_tsv @@ v_query
      order by rn
      limit 50
    ),
    vec as (
      select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_embedding, c.id) as rn
      from public.knowledge_chunks c
      join readable r on r.id = c.document_id and r.current_version_id = c.version_id
      where p_embedding is not null and c.tenant_id = v_tenant and c.embedding_model = p_embedding_model
      order by rn
      limit 50
    ),
    fused as (
      select id, sum(1.0 / (60 + rn)) as score from (select id, rn from fts union all select id, rn from vec) x group by id
    ),
    ranked as (
      select c.id, c.document_id, c.version_id, c.page_from, c.page_to, c.heading, c.content,
             r.title, r.title_ar, r.effective_date, r.source_url, r.is_authoritative, r.visibility,
             (select v.version_no from public.knowledge_document_versions v where v.id = c.version_id) as version_no,
             f.score * (case when r.is_authoritative then 1.25 else 1.0 end) * (0.75 + r.source_priority / 200.0) as score
      from fused f
      join public.knowledge_chunks c on c.id = f.id
      join readable r on r.id = c.document_id
      order by score desc, c.id
      limit v_limit
    )
    select jsonb_agg(jsonb_build_object(
      'chunk_id', id, 'document_id', document_id, 'version_id', version_id, 'version_no', version_no,
      'title', title, 'title_ar', title_ar, 'page_from', page_from, 'page_to', page_to, 'heading', heading,
      'content', content, 'score', round(score::numeric, 6), 'effective_date', effective_date,
      'source_url', source_url, 'is_authoritative', is_authoritative, 'visibility', visibility
    ) order by score desc, id)
    from ranked
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Usage of staff answers is booked to the staff assistant (same function otherwise).
-- ---------------------------------------------------------------------------

create or replace function public.assistant_complete_turn(
  p_conversation uuid,
  p_content text,
  p_status text,
  p_citations jsonb,
  p_sources jsonb,
  p_model text,
  p_usage jsonb,
  p_latency_ms integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.assistant_conversations;
  v_message uuid;
begin
  select * into c from public.assistant_conversations where id = p_conversation;
  if c.id is null or c.user_id <> auth.uid()
     or not (case when c.agent = 'admissions' then app.tenant_is_operating(c.tenant_id) else app.is_tenant_member(c.tenant_id) end) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('answered', 'no_sources', 'refused', 'error') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  insert into public.assistant_messages (tenant_id, conversation_id, role, content, status, citations, sources, model,
                                         input_tokens, output_tokens, latency_ms)
  values (c.tenant_id, c.id, 'assistant', p_content, p_status, coalesce(p_citations, '[]'::jsonb), coalesce(p_sources, '[]'::jsonb),
          p_model, nullif(p_usage ->> 'input_tokens', '')::integer, nullif(p_usage ->> 'output_tokens', '')::integer, p_latency_ms)
  returning id into v_message;

  if p_model is not null and p_usage is not null then
    insert into public.ai_usage_events (tenant_id, user_id, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
    values (c.tenant_id, auth.uid(), case c.agent when 'admissions' then 'admissions_agent' when 'staff' then 'staff_assistant' else 'student_assistant' end, p_model,
            coalesce((p_usage ->> 'input_tokens')::integer, 0), coalesce((p_usage ->> 'output_tokens')::integer, 0),
            coalesce((p_usage ->> 'cache_read_tokens')::integer, 0), coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
            coalesce((p_usage ->> 'cost_usd')::numeric, 0));
  end if;
  update public.assistant_conversations set updated_at = now() where id = c.id;
  return v_message;
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics with the staff assistant (its questions, cost and budget).
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
        'staff_assistant', coalesce(sum(u.cost_usd) filter (where u.feature = 'staff_assistant' and u.created_at >= date_trunc('month', now())), 0)
      ),
      'budgets', jsonb_build_object(
        'student_assistant', (select s.monthly_budget_usd from public.assistant_settings s where s.tenant_id = v_tenant),
        'admissions_agent', (select s.monthly_budget_usd from public.admissions_settings s where s.tenant_id = v_tenant),
        'academic_agent', (select s.monthly_budget_usd from public.academic_settings s where s.tenant_id = v_tenant),
        'staff_assistant', (select s.monthly_budget_usd from public.staff_assistant_settings s where s.tenant_id = v_tenant)
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
    'public.staff_assistant_status(text)',
    'public.staff_assistant_update_settings(text, boolean, text, numeric, integer)',
    'public.staff_assistant_usage(text)',
    'public.staff_begin_turn(text, uuid, text)',
    'public.staff_ai_begin(text, text)',
    'public.staff_save_draft(text, text, text, text, jsonb, jsonb, text, jsonb)',
    'public.staff_record_usage(text, text, jsonb)',
    'public.staff_delete_draft(uuid)',
    'public.staff_ticket_digest_source(text, text, uuid)',
    'public.search_knowledge(text, text, integer, extensions.vector, text, uuid)',
    'public.assistant_complete_turn(uuid, text, text, jsonb, jsonb, text, jsonb, integer)',
    'public.analytics_overview(text, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
