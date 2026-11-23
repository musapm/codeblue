-- UniAgent AI · Phase 5 · Migration 10: student assistant.
--
-- Conversations and messages (private to the student who wrote them), answer citations and the
-- retrieved sources, feedback, per-call AI usage with estimated cost, and per-university assistant
-- settings (on/off, extra instructions, monthly budget). All writes go through SECURITY DEFINER
-- functions that check membership, permission (assistant.use / assistant.configure), the
-- student_assistant feature, the university's switch and its monthly budget.
--
-- Integrity note: until the app has a service-role key, these functions are called with the
-- student's own session, so a student could add records to their OWN conversation through the
-- API. They cannot read or change anyone else's data, delete usage, or get past the budget.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.assistant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  instructions text constraint assistant_settings_instructions check (instructions is null or char_length(instructions) <= 2000),
  monthly_budget_usd numeric(10, 2) not null default 50
    constraint assistant_settings_budget check (monthly_budget_usd >= 0 and monthly_budget_usd <= 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null constraint assistant_conversations_title check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index assistant_conversations_user_idx on public.assistant_conversations (tenant_id, user_id, updated_at desc);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  conversation_id uuid not null,
  role text not null constraint assistant_messages_role check (role in ('user', 'assistant')),
  content text not null constraint assistant_messages_content check (char_length(content) between 1 and 20000),
  status text not null default 'answered'
    constraint assistant_messages_status check (status in ('question', 'answered', 'no_sources', 'refused', 'error')),
  citations jsonb not null default '[]'::jsonb constraint assistant_messages_citations check (jsonb_typeof(citations) = 'array'),
  sources jsonb not null default '[]'::jsonb constraint assistant_messages_sources check (jsonb_typeof(sources) = 'array'),
  model text constraint assistant_messages_model check (model is null or model ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'),
  input_tokens integer constraint assistant_messages_input check (input_tokens is null or input_tokens >= 0),
  output_tokens integer constraint assistant_messages_output check (output_tokens is null or output_tokens >= 0),
  latency_ms integer constraint assistant_messages_latency check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.assistant_conversations (tenant_id, id) on delete cascade
);
create index assistant_messages_conversation_idx on public.assistant_messages (conversation_id, created_at);

create table public.assistant_feedback (
  message_id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null constraint assistant_feedback_rating check (rating in (-1, 1)),
  comment text constraint assistant_feedback_comment check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, message_id) references public.assistant_messages (tenant_id, id) on delete cascade
);

-- One row per model call (also reused by later AI features). Cost is an estimate from the
-- provider-reported token usage and the price table in the app (docs/ai-architecture.md).
create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  feature text not null constraint ai_usage_feature check (feature ~ '^[a-z][a-z0-9_]{2,40}$'),
  model text not null constraint ai_usage_model check (model ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'),
  input_tokens integer not null default 0 constraint ai_usage_input check (input_tokens >= 0),
  output_tokens integer not null default 0 constraint ai_usage_output check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 constraint ai_usage_cache_read check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 constraint ai_usage_cache_write check (cache_write_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 constraint ai_usage_cost check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index ai_usage_events_tenant_idx on public.ai_usage_events (tenant_id, created_at desc);

create trigger assistant_settings_updated_at before update on public.assistant_settings
  for each row execute function app.set_updated_at();
create trigger assistant_conversations_updated_at before update on public.assistant_conversations
  for each row execute function app.set_updated_at();
create trigger assistant_settings_audit after insert or update or delete on public.assistant_settings
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS: conversations are private to their author; usage readable by assistant admins.
-- ---------------------------------------------------------------------------

alter table public.assistant_settings enable row level security;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_feedback enable row level security;
alter table public.ai_usage_events enable row level security;

revoke all on table public.assistant_settings, public.assistant_conversations, public.assistant_messages,
  public.assistant_feedback, public.ai_usage_events from anon, authenticated;
grant select on table public.assistant_settings, public.assistant_conversations, public.assistant_messages,
  public.assistant_feedback, public.ai_usage_events to authenticated;

create policy assistant_settings_select on public.assistant_settings for select to authenticated
  using (app.has_permission(tenant_id, 'assistant.configure'));
create policy assistant_conversations_select on public.assistant_conversations for select to authenticated
  using (user_id = auth.uid() and app.is_tenant_member(tenant_id));
create policy assistant_messages_select on public.assistant_messages for select to authenticated
  using (exists (
    select 1 from public.assistant_conversations c
    where c.id = conversation_id and c.user_id = auth.uid() and app.is_tenant_member(c.tenant_id)
  ));
create policy assistant_feedback_select on public.assistant_feedback for select to authenticated
  using (user_id = auth.uid());
create policy ai_usage_events_select on public.ai_usage_events for select to authenticated
  using (app.has_permission(tenant_id, 'assistant.configure'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function app.assistant_month_cost(p_tenant uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0)
  from public.ai_usage_events u
  where u.tenant_id = p_tenant and u.created_at >= date_trunc('month', now());
$$;
revoke all on function app.assistant_month_cost(uuid) from public;

-- ---------------------------------------------------------------------------
-- API
-- ---------------------------------------------------------------------------

-- What a member needs before asking: is the assistant available to them right now?
create or replace function public.assistant_status(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.assistant_settings;
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.assistant_settings where tenant_id = v_tenant;
  return jsonb_build_object(
    'can_use', app.has_permission(v_tenant, 'assistant.use'),
    'feature', app.tenant_has_feature(v_tenant, 'student_assistant'),
    'enabled', coalesce(s.enabled, false),
    'within_budget', app.assistant_month_cost(v_tenant) < coalesce(s.monthly_budget_usd, 0)
  );
end;
$$;

create or replace function public.assistant_update_settings(
  p_tenant_slug text,
  p_enabled boolean,
  p_instructions text,
  p_monthly_budget_usd numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.configure') or not app.tenant_has_feature(v_tenant, 'student_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.assistant_settings (tenant_id, enabled, instructions, monthly_budget_usd, updated_by)
  values (v_tenant, coalesce(p_enabled, false), nullif(btrim(p_instructions), ''), coalesce(p_monthly_budget_usd, 50), auth.uid())
  on conflict (tenant_id) do update
  set enabled = excluded.enabled, instructions = excluded.instructions,
      monthly_budget_usd = excluded.monthly_budget_usd, updated_by = excluded.updated_by;
end;
$$;

-- Start a turn: checks every gate, creates the conversation when needed, stores the question and
-- returns the recent history (for context), the university's extra instructions and its support
-- address (the assistant's hand-off contact).
create or replace function public.assistant_begin_turn(p_tenant_slug text, p_conversation uuid, p_question text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_conversation uuid := p_conversation;
  v_question text := btrim(coalesce(p_question, ''));
  s public.assistant_settings;
  v_history jsonb;
  v_message uuid;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.use') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not app.tenant_has_feature(v_tenant, 'student_assistant') then
    raise exception 'assistant not available' using errcode = '42501';
  end if;
  select * into s from public.assistant_settings where tenant_id = v_tenant;
  if s.tenant_id is null or not s.enabled then
    raise exception 'assistant is turned off' using errcode = '55000';
  end if;
  if app.assistant_month_cost(v_tenant) >= s.monthly_budget_usd then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if char_length(v_question) < 2 or char_length(v_question) > 2000 then
    raise exception 'invalid question' using errcode = '22023';
  end if;

  if v_conversation is null then
    insert into public.assistant_conversations (tenant_id, user_id, title)
    values (v_tenant, auth.uid(), left(regexp_replace(v_question, '\s+', ' ', 'g'), 120))
    returning id into v_conversation;
    v_history := '[]'::jsonb;
  else
    if not exists (
      select 1 from public.assistant_conversations c
      where c.id = v_conversation and c.tenant_id = v_tenant and c.user_id = auth.uid()
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
    'support_email', (select ts.support_email from public.tenant_settings ts where ts.tenant_id = v_tenant)
  );
end;
$$;

-- Store the answer (or the reason there is none) and the usage of the model call, if any.
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
  if c.id is null or c.user_id <> auth.uid() or not app.is_tenant_member(c.tenant_id) then
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
    values (c.tenant_id, auth.uid(), 'student_assistant', p_model,
            coalesce((p_usage ->> 'input_tokens')::integer, 0), coalesce((p_usage ->> 'output_tokens')::integer, 0),
            coalesce((p_usage ->> 'cache_read_tokens')::integer, 0), coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
            coalesce((p_usage ->> 'cost_usd')::numeric, 0));
  end if;
  update public.assistant_conversations set updated_at = now() where id = c.id;
  return v_message;
end;
$$;

create or replace function public.assistant_set_feedback(p_message uuid, p_rating smallint, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.assistant_messages;
begin
  select msg.* into m
  from public.assistant_messages msg
  join public.assistant_conversations c on c.id = msg.conversation_id
  where msg.id = p_message and msg.role = 'assistant' and c.user_id = auth.uid() and app.is_tenant_member(c.tenant_id);
  if m.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.assistant_feedback (message_id, tenant_id, user_id, rating, comment)
  values (m.id, m.tenant_id, auth.uid(), p_rating, nullif(btrim(p_comment), ''))
  on conflict (message_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now();
end;
$$;

-- This month's figures for the assistant settings page (aggregates only, no conversation content).
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
  return jsonb_build_object(
    'since', v_since,
    'questions', (select count(*) from public.assistant_messages m where m.tenant_id = v_tenant and m.role = 'user' and m.created_at >= v_since),
    'answered', (select count(*) from public.assistant_messages m where m.tenant_id = v_tenant and m.status = 'answered' and m.created_at >= v_since),
    'no_sources', (select count(*) from public.assistant_messages m where m.tenant_id = v_tenant and m.status = 'no_sources' and m.created_at >= v_since),
    'refused', (select count(*) from public.assistant_messages m where m.tenant_id = v_tenant and m.status = 'refused' and m.created_at >= v_since),
    'errors', (select count(*) from public.assistant_messages m where m.tenant_id = v_tenant and m.status = 'error' and m.created_at >= v_since),
    'helpful', (select count(*) from public.assistant_feedback f where f.tenant_id = v_tenant and f.rating = 1 and f.created_at >= v_since),
    'not_helpful', (select count(*) from public.assistant_feedback f where f.tenant_id = v_tenant and f.rating = -1 and f.created_at >= v_since),
    'input_tokens', (select coalesce(sum(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens), 0) from public.ai_usage_events u where u.tenant_id = v_tenant and u.created_at >= v_since),
    'output_tokens', (select coalesce(sum(u.output_tokens), 0) from public.ai_usage_events u where u.tenant_id = v_tenant and u.created_at >= v_since),
    'cost_usd', app.assistant_month_cost(v_tenant)
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.assistant_status(text)',
    'public.assistant_update_settings(text, boolean, text, numeric)',
    'public.assistant_begin_turn(text, uuid, text)',
    'public.assistant_complete_turn(uuid, text, text, jsonb, jsonb, text, jsonb, integer)',
    'public.assistant_set_feedback(uuid, smallint, text)',
    'public.assistant_usage_summary(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
