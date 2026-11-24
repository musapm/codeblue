-- UniAgent AI · Phase 13 · Migration 19: voice (speech input and read-aloud).
--
-- * Voice is a feature ('voice') that a university switches on (voice_settings, off by
--   default) for its assistant chats: speech input (speech to text) and reading answers aloud
--   (text to speech), each on or off.
-- * Providers sit behind one interface. 'browser' uses the speech features of the person's own
--   browser (no server cost; some browsers process speech on their maker's servers, which the
--   app cannot control, so the pages say so). 'server' sends audio or text to a speech
--   provider the university contracts; the app checks a monthly budget and a daily limit per
--   person before each call. No provider prices are built in: administrators enter their
--   contract's unit prices, and costs are computed from them.
-- * Usage has its own table (voice_usage_events): seconds of speech input and characters read
--   aloud, per provider and surface. No audio and no text is stored.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.voice_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  input_enabled boolean not null default true,
  output_enabled boolean not null default true,
  provider text not null default 'browser' constraint voice_settings_provider check (provider in ('browser', 'server')),
  -- The university's contract prices (USD); null: not entered (cost shown as unknown).
  input_price_per_minute numeric(10, 4) constraint voice_settings_input_price check (input_price_per_minute is null or input_price_per_minute between 0 and 100),
  output_price_per_1k_chars numeric(10, 4) constraint voice_settings_output_price check (output_price_per_1k_chars is null or output_price_per_1k_chars between 0 and 100),
  monthly_budget_usd numeric(10, 2) not null default 5
    constraint voice_settings_budget check (monthly_budget_usd >= 0 and monthly_budget_usd <= 100000),
  -- Server provider: seconds of speech input per person per day.
  daily_input_seconds integer not null default 600 constraint voice_settings_daily check (daily_input_seconds between 10 and 36000),
  updated_at timestamptz not null default now()
);

create table public.voice_usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null constraint voice_usage_kind check (kind in ('input', 'output')),
  provider text not null constraint voice_usage_provider check (provider in ('browser', 'server')),
  surface text not null constraint voice_usage_surface check (surface in ('student_chat', 'staff_chat')),
  seconds numeric(8, 2) not null default 0 constraint voice_usage_seconds check (seconds >= 0 and seconds <= 600),
  characters integer not null default 0 constraint voice_usage_characters check (characters >= 0 and characters <= 20000),
  -- Null when the price was not entered (server provider), 0 for the browser.
  cost_usd numeric(12, 6) constraint voice_usage_cost check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index voice_usage_events_tenant_idx on public.voice_usage_events (tenant_id, created_at desc);
create index voice_usage_events_user_idx on public.voice_usage_events (tenant_id, user_id, created_at desc);

create trigger voice_settings_updated_at before update on public.voice_settings
  for each row execute function app.set_updated_at();
create trigger voice_settings_audit after insert or update or delete on public.voice_settings
  for each row execute function app.audit_row_change();

alter table public.voice_settings enable row level security;
alter table public.voice_usage_events enable row level security;
revoke all on table public.voice_settings, public.voice_usage_events from anon, authenticated;
grant select on table public.voice_settings to authenticated;
-- Usage rows are read only through voice_usage (aggregates); nobody selects them directly.

create policy voice_settings_select on public.voice_settings for select to authenticated
  using (app.has_permission(tenant_id, 'assistant.configure'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function app.voice_month_cost(p_tenant uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0) from public.voice_usage_events u
  where u.tenant_id = p_tenant and u.created_at >= date_trunc('month', now());
$$;

-- Who may use voice in a chat surface: the feature and switch, and the chat's own permission.
create or replace function app.voice_can_use(p_tenant uuid, p_surface text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.tenant_has_feature(p_tenant, 'voice')
    and exists (select 1 from public.voice_settings s where s.tenant_id = p_tenant and s.enabled)
    and case p_surface
          when 'student_chat' then app.has_permission(p_tenant, 'assistant.use') and app.tenant_has_feature(p_tenant, 'student_assistant')
          when 'staff_chat' then app.has_permission(p_tenant, 'assistant.staff.use') and app.tenant_has_feature(p_tenant, 'staff_assistant')
          else false
        end, false);
$$;

revoke all on function app.voice_month_cost(uuid), app.voice_can_use(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- API
-- ---------------------------------------------------------------------------

create or replace function public.voice_status(p_tenant_slug text, p_surface text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.voice_settings;
  v_can boolean;
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.voice_settings where tenant_id = v_tenant;
  v_can := app.voice_can_use(v_tenant, p_surface);
  return jsonb_build_object(
    'available', v_can,
    'input', v_can and s.input_enabled,
    'output', v_can and s.output_enabled,
    'provider', coalesce(s.provider, 'browser'),
    'within_budget', s.tenant_id is not null and (s.provider = 'browser' or app.voice_month_cost(v_tenant) < s.monthly_budget_usd)
  );
end;
$$;

create or replace function public.voice_update_settings(
  p_tenant_slug text,
  p_enabled boolean,
  p_input_enabled boolean,
  p_output_enabled boolean,
  p_provider text,
  p_input_price_per_minute numeric,
  p_output_price_per_1k_chars numeric,
  p_monthly_budget_usd numeric,
  p_daily_input_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.configure') or not app.tenant_has_feature(v_tenant, 'voice') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.voice_settings (tenant_id, enabled, input_enabled, output_enabled, provider, input_price_per_minute,
                                     output_price_per_1k_chars, monthly_budget_usd, daily_input_seconds)
  values (v_tenant, coalesce(p_enabled, false), coalesce(p_input_enabled, true), coalesce(p_output_enabled, true), p_provider,
          p_input_price_per_minute, p_output_price_per_1k_chars, p_monthly_budget_usd, p_daily_input_seconds)
  on conflict (tenant_id) do update
    set enabled = excluded.enabled, input_enabled = excluded.input_enabled, output_enabled = excluded.output_enabled,
        provider = excluded.provider, input_price_per_minute = excluded.input_price_per_minute,
        output_price_per_1k_chars = excluded.output_price_per_1k_chars, monthly_budget_usd = excluded.monthly_budget_usd,
        daily_input_seconds = excluded.daily_input_seconds;
end;
$$;

-- Before a server provider call: the switch, the kind, the budget and (speech input) the daily limit.
create or replace function public.voice_begin(p_tenant_slug text, p_surface text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.voice_settings;
begin
  if v_tenant is null or not app.voice_can_use(v_tenant, p_surface) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.voice_settings where tenant_id = v_tenant;
  if p_kind is null or p_kind not in ('input', 'output') or s.provider <> 'server' then
    raise exception 'invalid voice request' using errcode = '22023';
  end if;
  if (p_kind = 'input' and not s.input_enabled) or (p_kind = 'output' and not s.output_enabled) then
    raise exception 'turned off' using errcode = '55000';
  end if;
  if app.voice_month_cost(v_tenant) >= s.monthly_budget_usd then
    raise exception 'monthly voice budget reached' using errcode = '53400';
  end if;
  if p_kind = 'input' and (
    select coalesce(sum(u.seconds), 0) from public.voice_usage_events u
    where u.tenant_id = v_tenant and u.user_id = auth.uid() and u.kind = 'input' and u.created_at > now() - interval '24 hours'
  ) >= s.daily_input_seconds then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;
  return jsonb_build_object('provider', s.provider);
end;
$$;

-- Book usage. The cost comes from the university's prices, never from the caller.
create or replace function public.voice_record(p_tenant_slug text, p_surface text, p_kind text, p_provider text, p_seconds numeric, p_characters integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.voice_settings;
  v_cost numeric;
begin
  if v_tenant is null or not app.voice_can_use(v_tenant, p_surface) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.voice_settings where tenant_id = v_tenant;
  if p_kind is null or p_kind not in ('input', 'output') or p_provider is null or p_provider <> s.provider then
    raise exception 'invalid voice usage' using errcode = '22023';
  end if;
  v_cost := case
    when p_provider = 'browser' then 0
    when p_kind = 'input' then round(coalesce(p_seconds, 0) / 60 * s.input_price_per_minute, 6)
    else round(coalesce(p_characters, 0)::numeric / 1000 * s.output_price_per_1k_chars, 6)
  end;
  insert into public.voice_usage_events (tenant_id, user_id, kind, provider, surface, seconds, characters, cost_usd)
  values (v_tenant, auth.uid(), p_kind, p_provider, p_surface,
          case when p_kind = 'input' then coalesce(p_seconds, 0) else 0 end,
          case when p_kind = 'output' then coalesce(p_characters, 0) else 0 end,
          v_cost);
end;
$$;

-- This month, for the settings page: speech input minutes, characters read aloud, people, cost.
create or replace function public.voice_usage(p_tenant_slug text)
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
    select jsonb_build_object(
      'since', v_since,
      'input_minutes', round(coalesce(sum(u.seconds) filter (where u.kind = 'input'), 0) / 60, 1),
      'input_uses', count(*) filter (where u.kind = 'input'),
      'output_characters', coalesce(sum(u.characters) filter (where u.kind = 'output'), 0),
      'output_uses', count(*) filter (where u.kind = 'output'),
      'people', count(distinct u.user_id),
      'cost_usd', coalesce(sum(u.cost_usd), 0),
      'unpriced', count(*) filter (where u.cost_usd is null)
    )
    from public.voice_usage_events u
    where u.tenant_id = v_tenant and u.created_at >= v_since
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics: voice use (replaces migration 18's)
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
  v_voice jsonb;
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
        'workflow_agent', coalesce(sum(u.cost_usd) filter (where u.feature = 'workflow_agent' and u.created_at >= date_trunc('month', now())), 0),
        'campus_assistant', coalesce(sum(u.cost_usd) filter (where u.feature = 'campus_assistant' and u.created_at >= date_trunc('month', now())), 0)
      ),
      'budgets', jsonb_build_object(
        'student_assistant', (select s.monthly_budget_usd from public.assistant_settings s where s.tenant_id = v_tenant),
        'admissions_agent', (select s.monthly_budget_usd from public.admissions_settings s where s.tenant_id = v_tenant),
        'academic_agent', (select s.monthly_budget_usd from public.academic_settings s where s.tenant_id = v_tenant),
        'staff_assistant', (select s.monthly_budget_usd from public.staff_assistant_settings s where s.tenant_id = v_tenant),
        'workflow_agent', (select s.monthly_budget_usd from public.workflow_settings s where s.tenant_id = v_tenant),
        'campus_assistant', (select s.monthly_budget_usd from public.campus_settings s where s.tenant_id = v_tenant)
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

  -- Voice (Phase 13): use only (minutes, characters, people), from its own usage table.
  if app.tenant_has_feature(v_tenant, 'voice') then
    select jsonb_build_object(
      'input_minutes', round(coalesce(sum(u.seconds) filter (where u.kind = 'input'), 0) / 60, 1),
      'output_characters', coalesce(sum(u.characters) filter (where u.kind = 'output'), 0),
      'people', count(distinct u.user_id),
      'cost_usd', case when app.has_permission(v_tenant, 'analytics.ai_costs.view') then coalesce(sum(u.cost_usd), 0) end,
      'month_cost_usd', case when app.has_permission(v_tenant, 'analytics.ai_costs.view') then app.voice_month_cost(v_tenant) end,
      'budget_usd', case when app.has_permission(v_tenant, 'analytics.ai_costs.view') then (select s.monthly_budget_usd from public.voice_settings s where s.tenant_id = v_tenant and s.provider = 'server') end
    )
    into v_voice
    from public.voice_usage_events u
    where u.tenant_id = v_tenant and u.created_at >= v_since;
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
    'voice', v_voice,
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
    'public.voice_status(text, text)',
    'public.voice_update_settings(text, boolean, boolean, boolean, text, numeric, numeric, numeric, integer)',
    'public.voice_begin(text, text, text)',
    'public.voice_record(text, text, text, text, numeric, integer)',
    'public.voice_usage(text)',
    'public.analytics_overview(text, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
