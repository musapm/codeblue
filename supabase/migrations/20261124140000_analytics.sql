-- UniAgent AI · Phase 8 · Migration 14: admin dashboard, analytics and AI quality review.
--
-- * Every number is computed from stored rows when it is asked for: assistant messages and
--   feedback, AI usage events, tickets, admissions leads, knowledge documents and memberships.
--   Nothing is estimated or filled in: a period without data shows zeros. Days are the
--   university's own days (tenants.timezone). No rollup tables yet (ADR-028).
-- * analytics.view (feature analytics_basic) gives aggregate numbers only: never content and
--   never who asked. AI costs also need analytics.ai_costs.view. Periods longer than 30 days
--   need the analytics_advanced feature.
-- * Knowledge gaps (questions the assistant found no source for) are listed for quality.review
--   or knowledge.manage: grouped by question, without the person or the conversation, and
--   with contact details, links and long numbers redacted (best effort).
-- * Flagged answers (rated not helpful, declined by the model) are shown to quality.review
--   only, one exchange at a time. The answer and its citations are shown only when the
--   reviewer could read every document it was built from: the person who asked may have had
--   wider access than the reviewer.
-- * Reviews are stored in ai_quality_reviews. Like tickets and leads they are not copied into
--   the append-only audit log, because a note may quote a question.

-- ---------------------------------------------------------------------------
-- Indexes for period queries
-- ---------------------------------------------------------------------------

create index assistant_messages_tenant_time_idx on public.assistant_messages (tenant_id, created_at);
create index assistant_feedback_tenant_time_idx on public.assistant_feedback (tenant_id, created_at);
create index tickets_tenant_created_idx on public.tickets (tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers (private schema; called by the API functions below)
-- ---------------------------------------------------------------------------

-- The last p_days of the university's own days: time zone, first day, and the instant it began.
create or replace function app.analytics_period(p_tenant uuid, p_days integer, out tz text, out first_day date, out since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.timezone,
         (now() at time zone t.timezone)::date - (p_days - 1),
         (((now() at time zone t.timezone)::date - (p_days - 1))::timestamp) at time zone t.timezone
  from public.tenants t
  where t.id = p_tenant;
$$;

-- Is the assistant behind a conversation turned on for the university?
create or replace function app.agent_enabled(p_tenant uuid, p_agent text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case p_agent
    when 'student' then app.tenant_has_feature(p_tenant, 'student_assistant')
    when 'admissions' then app.tenant_has_feature(p_tenant, 'admissions_agent')
  end, false);
$$;

-- Best-effort removal of contact details and identifiers from text shown to reviewers:
-- e-mail addresses, links (they may carry tokens), and digit runs of 8 or more digits
-- (phone numbers, student and national ids), also in Arabic-Indic digits. Dates are kept.
-- Names cannot be detected reliably; reviewers see questions without who asked them.
create or replace function app.redact_pii(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  r text := p;
  m text;
begin
  if r is null then
    return null;
  end if;
  r := regexp_replace(r, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g');
  r := regexp_replace(r, 'https?://[^[:space:]]+', '[link]', 'gi');
  for m in
    select distinct x[1] from regexp_matches(r, '(\+?[0-9٠-٩۰-۹][0-9٠-٩۰-۹ ().-]{6,}[0-9٠-٩۰-۹])', 'g') as x
  loop
    if char_length(regexp_replace(m, '[^0-9٠-٩۰-۹]', '', 'g')) >= 8
       and m !~ '^[0-9]{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2}$'
       and m !~ '^[0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{4}$' then
      r := replace(r, m, '[number]');
    end if;
  end loop;
  return r;
end;
$$;

-- Grouping key for questions: case, punctuation, spacing, Arabic letter variants, diacritics,
-- tatweel and Arabic-Indic digits do not make two questions different.
create or replace function app.normalize_question(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(p, '')), 'أإآىة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ـ', 'ااايه01234567890123456789'),
      '[' || chr(1611) || '-' || chr(1618) || ']', '', 'g'),
    '[[:punct:][:space:]؟،؛«»“”‘’…–—]+', ' ', 'g')), 300);
$$;

-- Could the caller read this document's content, whatever its publication state now? Used
-- before a reviewer sees an answer that was built from it.
create or replace function app.can_see_document_content(p_tenant uuid, p_document uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select app.has_permission(p_tenant, 'knowledge.publish')
      or d.created_by = auth.uid()
      or (d.visibility <> 'restricted' and app.has_permission(p_tenant, 'knowledge.manage'))
      or case d.visibility
           when 'public' then app.has_permission(p_tenant, 'knowledge.read_public') or app.has_permission(p_tenant, 'knowledge.read_internal')
           when 'members' then app.has_permission(p_tenant, 'knowledge.read_public') or app.has_permission(p_tenant, 'knowledge.read_internal')
           when 'staff' then app.has_permission(p_tenant, 'knowledge.read_internal')
           else app.has_permission(p_tenant, 'knowledge.read_internal') and exists (
             select 1
             from public.knowledge_document_access a
             where a.document_id = d.id
               and (
                 (a.department_id is not null and app.in_department(p_tenant, a.department_id))
                 or (a.role_id is not null and exists (
                   select 1
                   from public.tenant_memberships mm
                   join public.membership_roles mr on mr.membership_id = mm.id
                   where mm.tenant_id = p_tenant and mm.user_id = auth.uid() and mm.status = 'active' and mr.role_id = a.role_id
                 ))
               )
           )
         end
    from public.knowledge_documents d
    where d.id = p_document and d.tenant_id = p_tenant
  ), false);
$$;

-- May the caller see an answer built from these sources and citations? Every knowledge
-- document involved must be readable by the caller. Admissions program records are public.
-- Anything that cannot be checked (deleted documents, malformed entries) hides the answer.
create or replace function app.can_see_answer(p_tenant uuid, p_sources jsonb, p_citations jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from (
      select s ->> 'document_id' as doc
      from jsonb_array_elements(case when jsonb_typeof(p_sources) = 'array' then p_sources else '[]'::jsonb end) as s
      where jsonb_typeof(s) <> 'object' or not (s ? 'program_id')
      union
      select c ->> 'document_id'
      from jsonb_array_elements(case when jsonb_typeof(p_citations) = 'array' then p_citations else '[]'::jsonb end) as c
      where jsonb_typeof(c) <> 'object' or not (c ? 'program_id')
    ) d
    where app.try_uuid(d.doc) is null
       or not app.can_see_document_content(p_tenant, app.try_uuid(d.doc))
  );
$$;

-- The question an assistant message answers: the latest question before it in its conversation.
create or replace function app.question_of(p_conversation uuid, p_answered_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select q.content
  from public.assistant_messages q
  where q.conversation_id = p_conversation and q.role = 'user' and q.created_at <= p_answered_at
  order by q.created_at desc
  limit 1;
$$;

revoke all on function app.analytics_period(uuid, integer), app.agent_enabled(uuid, text), app.redact_pii(text),
  app.normalize_question(text), app.can_see_document_content(uuid, uuid), app.can_see_answer(uuid, jsonb, jsonb),
  app.question_of(uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- AI quality reviews
-- ---------------------------------------------------------------------------

create table public.ai_quality_reviews (
  message_id uuid primary key,
  tenant_id uuid not null,
  outcome text not null
    constraint ai_quality_reviews_outcome check (outcome in ('correct', 'knowledge_added', 'knowledge_needed', 'assistant_error', 'out_of_scope')),
  note text constraint ai_quality_reviews_note check (note is null or char_length(note) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewer_name text not null constraint ai_quality_reviews_reviewer check (char_length(reviewer_name) between 1 and 320),
  reviewed_at timestamptz not null default now(),
  foreign key (tenant_id, message_id) references public.assistant_messages (tenant_id, id) on delete cascade
);
create index ai_quality_reviews_tenant_idx on public.ai_quality_reviews (tenant_id, reviewed_at desc);

alter table public.ai_quality_reviews enable row level security;
revoke all on table public.ai_quality_reviews from anon, authenticated;
grant select on table public.ai_quality_reviews to authenticated;
create policy ai_quality_reviews_select on public.ai_quality_reviews for select to authenticated
  using (app.has_permission(tenant_id, 'quality.review'));

-- Counts of flagged items in a period: waiting for review, reviewed, and outcomes.
create or replace function app.quality_counts(p_tenant uuid, p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select m.status, m.created_at, f.rating, f.created_at as rated_at, r.message_id is not null as reviewed
    from public.assistant_messages m
    join public.assistant_conversations c on c.id = m.conversation_id
    left join public.assistant_feedback f on f.message_id = m.id
    left join public.ai_quality_reviews r on r.message_id = m.id
    where m.tenant_id = p_tenant and m.role = 'assistant' and app.agent_enabled(p_tenant, c.agent)
      and ((m.status in ('no_sources', 'refused') and m.created_at >= p_since) or (f.rating = -1 and f.created_at >= p_since))
  ),
  reviews as (
    select r.outcome
    from public.ai_quality_reviews r
    join public.assistant_messages m on m.id = r.message_id
    join public.assistant_conversations c on c.id = m.conversation_id
    where r.tenant_id = p_tenant and r.reviewed_at >= p_since and app.agent_enabled(p_tenant, c.agent)
  )
  select jsonb_build_object(
    'gaps_open', (select count(*) from items where status = 'no_sources' and created_at >= p_since and not reviewed),
    'negative_open', (select count(*) from items where rating = -1 and rated_at >= p_since and not reviewed),
    'refused_open', (select count(*) from items where status = 'refused' and created_at >= p_since and not reviewed),
    'reviewed', (select count(*) from reviews),
    'outcomes', jsonb_build_object(
      'correct', (select count(*) from reviews where outcome = 'correct'),
      'knowledge_added', (select count(*) from reviews where outcome = 'knowledge_added'),
      'knowledge_needed', (select count(*) from reviews where outcome = 'knowledge_needed'),
      'assistant_error', (select count(*) from reviews where outcome = 'assistant_error'),
      'out_of_scope', (select count(*) from reviews where outcome = 'out_of_scope')
    )
  );
$$;
revoke all on function app.quality_counts(uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- API: analytics
-- ---------------------------------------------------------------------------

-- Everything the dashboard shows for the last p_days (7 or 30; 90 with analytics_advanced).
-- Sections are null when the feature is off (or, for AI costs and quality, without the permission).
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
  v_assistant jsonb;
  v_tickets jsonb;
  v_leads jsonb;
  v_knowledge jsonb;
  v_ai jsonb;
  v_quality jsonb;
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

  -- Assistants: questions, outcomes, people, feedback and a series per day (or week).
  if v_student or v_admissions then
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
          join public.knowledge_documents kd on kd.id = x.doc and kd.tenant_id = v_tenant
          where app.can_read_knowledge(v_tenant, kd.id)
          order by x.answers desc, kd.title
          limit 10
        ) as y
      ), '[]'::jsonb)
    )
    into v_knowledge
    from public.knowledge_documents d
    where d.tenant_id = v_tenant;
  end if;

  -- AI usage and estimated cost (calendar month, as the budgets are enforced).
  if app.has_permission(v_tenant, 'analytics.ai_costs.view') then
    select jsonb_build_object(
      'month_since', date_trunc('month', now()),
      'month', jsonb_build_object(
        'student_assistant', coalesce(sum(u.cost_usd) filter (where u.feature = 'student_assistant' and u.created_at >= date_trunc('month', now())), 0),
        'admissions_agent', coalesce(sum(u.cost_usd) filter (where u.feature = 'admissions_agent' and u.created_at >= date_trunc('month', now())), 0),
        'ticketing', coalesce(sum(u.cost_usd) filter (where u.feature = 'ticketing' and u.created_at >= date_trunc('month', now())), 0)
      ),
      'budgets', jsonb_build_object(
        'student_assistant', (select s.monthly_budget_usd from public.assistant_settings s where s.tenant_id = v_tenant),
        'admissions_agent', (select s.monthly_budget_usd from public.admissions_settings s where s.tenant_id = v_tenant)
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
-- API: knowledge gaps and AI quality review
-- ---------------------------------------------------------------------------

create or replace function app.quality_filters_valid(p_days integer, p_agent text, p_state text, p_limit integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_days in (7, 30, 90) and (p_agent is null or p_agent in ('student', 'admissions'))
    and p_state in ('open', 'reviewed', 'all') and p_limit between 1 and 100, false);
$$;
revoke all on function app.quality_filters_valid(integer, text, text, integer) from public;

-- Questions the assistants found no source for, grouped by question (most asked first).
-- No person, no conversation; the shown wording is the latest one, redacted.
create or replace function public.quality_gaps(p_tenant_slug text, p_days integer, p_agent text, p_state text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_since timestamptz;
begin
  if v_tenant is null or not (app.has_permission(v_tenant, 'quality.review') or app.has_permission(v_tenant, 'knowledge.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not app.quality_filters_valid(p_days, p_agent, p_state, p_limit) then
    raise exception 'invalid filter' using errcode = '22023';
  end if;
  select a.since into v_since from app.analytics_period(v_tenant, p_days) as a;

  return coalesce((
    select jsonb_agg(g.item order by g.n desc, g.last_at desc)
    from (
      select count(*) as n, max(x.created_at) as last_at,
        jsonb_build_object(
          'question', app.redact_pii((array_agg(x.question order by x.created_at desc))[1]),
          'count', count(*),
          'open', count(*) filter (where x.outcome is null),
          'first_at', min(x.created_at),
          'last_at', max(x.created_at),
          'agents', to_jsonb(array_agg(distinct x.agent)),
          'open_ids', to_jsonb(coalesce((array_agg(x.id order by x.created_at desc) filter (where x.outcome is null))[1:200], '{}'::uuid[])),
          'reviewed_ids', to_jsonb(coalesce((array_agg(x.id order by x.created_at desc) filter (where x.outcome is not null))[1:200], '{}'::uuid[])),
          'review', (array_agg(jsonb_build_object('outcome', x.outcome, 'note', x.note, 'reviewer', x.reviewer_name, 'at', x.reviewed_at)
                               order by x.reviewed_at desc) filter (where x.outcome is not null))[1]
        ) as item
      from (
        select m.id, m.created_at, c.agent, q.question, app.normalize_question(q.question) as key,
               r.outcome, r.note, r.reviewer_name, r.reviewed_at
        from public.assistant_messages m
        join public.assistant_conversations c on c.id = m.conversation_id
        cross join lateral (select app.question_of(m.conversation_id, m.created_at) as question) as q
        left join public.ai_quality_reviews r on r.message_id = m.id
        where m.tenant_id = v_tenant and m.role = 'assistant' and m.status = 'no_sources' and m.created_at >= v_since
          and q.question is not null
          and app.agent_enabled(v_tenant, c.agent)
          and (p_agent is null or c.agent = p_agent)
      ) as x
      group by x.key
      having case p_state
               when 'open' then count(*) filter (where x.outcome is null) > 0
               when 'reviewed' then count(*) filter (where x.outcome is null) = 0
               else true
             end
      order by count(*) desc, max(x.created_at) desc
      limit p_limit
    ) as g
  ), '[]'::jsonb);
end;
$$;

-- Answers rated "not helpful" (p_kind 'negative') or declined by the model ('refused'), newest
-- first, one exchange each, without the person. The answer and its citations only when the
-- reviewer could read every document behind it ("visible").
create or replace function public.quality_flagged(p_tenant_slug text, p_kind text, p_days integer, p_agent text, p_state text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_since timestamptz;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'quality.review') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(p_kind, '') not in ('negative', 'refused') or not app.quality_filters_valid(p_days, p_agent, p_state, p_limit) then
    raise exception 'invalid filter' using errcode = '22023';
  end if;
  select a.since into v_since from app.analytics_period(v_tenant, p_days) as a;

  return coalesce((
    select jsonb_agg(x.item order by x.sort_at desc)
    from (
      select coalesce(f.created_at, m.created_at) as sort_at,
        jsonb_build_object(
          'id', m.id,
          'agent', c.agent,
          'status', m.status,
          'answered_at', m.created_at,
          'rated_at', f.created_at,
          'question', app.redact_pii(app.question_of(m.conversation_id, m.created_at)),
          'comment', app.redact_pii(f.comment),
          'visible', v.ok,
          'answer', case when v.ok then app.redact_pii(left(m.content, 6000)) end,
          'citations', case when v.ok then coalesce((
            select jsonb_agg(jsonb_build_object(
              'n', ci -> 'n',
              'title', ci ->> 'title',
              'page_from', ci -> 'page_from',
              'page_to', ci -> 'page_to',
              'text', app.redact_pii(left(ci ->> 'cited_text', 500)),
              'program', ci ? 'program_id'
            ) order by e.i)
            from jsonb_array_elements(m.citations) with ordinality as e (ci, i)
            where jsonb_typeof(e.ci) = 'object'
          ), '[]'::jsonb) else '[]'::jsonb end,
          'review', case when r.message_id is null then null else jsonb_build_object(
            'outcome', r.outcome, 'note', r.note, 'reviewer', r.reviewer_name, 'at', r.reviewed_at) end
        ) as item
      from public.assistant_messages m
      join public.assistant_conversations c on c.id = m.conversation_id
      left join public.assistant_feedback f on f.message_id = m.id
      left join public.ai_quality_reviews r on r.message_id = m.id
      cross join lateral (select app.can_see_answer(v_tenant, m.sources, m.citations) as ok) as v
      where m.tenant_id = v_tenant and m.role = 'assistant'
        and app.agent_enabled(v_tenant, c.agent)
        and (p_agent is null or c.agent = p_agent)
        and case p_kind
              when 'negative' then f.rating = -1 and f.created_at >= v_since
              else m.status = 'refused' and m.created_at >= v_since
            end
        and case p_state
              when 'open' then r.message_id is null
              when 'reviewed' then r.message_id is not null
              else true
            end
      order by coalesce(f.created_at, m.created_at) desc
      limit p_limit
    ) as x
  ), '[]'::jsonb);
end;
$$;

-- Tab counts for the quality page.
create or replace function public.quality_summary(p_tenant_slug text, p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_since timestamptz;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'quality.review') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  select a.since into v_since from app.analytics_period(v_tenant, p_days) as a;
  return app.quality_counts(v_tenant, v_since);
end;
$$;

-- Record the outcome of a review for one or more flagged answers (a group of identical
-- unanswered questions is reviewed at once). Saving again changes the outcome.
create or replace function public.quality_review_save(p_tenant_slug text, p_messages uuid[], p_outcome text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_count integer;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'quality.review') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('correct', 'knowledge_added', 'knowledge_needed', 'assistant_error', 'out_of_scope')
     or p_messages is null or coalesce(cardinality(p_messages), 0) not between 1 and 200 then
    raise exception 'invalid review' using errcode = '22023';
  end if;
  -- Only flagged answers of this university, from an assistant it has turned on.
  if exists (
    select 1
    from unnest(p_messages) as x (id)
    where not exists (
      select 1
      from public.assistant_messages m
      join public.assistant_conversations c on c.id = m.conversation_id
      left join public.assistant_feedback f on f.message_id = m.id
      where m.id = x.id and m.tenant_id = v_tenant and m.role = 'assistant' and app.agent_enabled(v_tenant, c.agent)
        and (m.status in ('no_sources', 'refused') or f.rating = -1)
    )
  ) then
    raise exception 'message cannot be reviewed' using errcode = '22023';
  end if;

  insert into public.ai_quality_reviews (message_id, tenant_id, outcome, note, reviewed_by, reviewer_name)
  select distinct x.id, v_tenant, p_outcome, nullif(btrim(p_note), ''), auth.uid(), app.display_name(auth.uid())
  from unnest(p_messages) as x (id)
  on conflict (message_id) do update
    set outcome = excluded.outcome,
        note = excluded.note,
        reviewed_by = excluded.reviewed_by,
        reviewer_name = excluded.reviewer_name,
        reviewed_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Put reviewed answers back in the queue.
create or replace function public.quality_review_reopen(p_tenant_slug text, p_messages uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_count integer;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'quality.review') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_messages is null or coalesce(cardinality(p_messages), 0) not between 1 and 200 then
    raise exception 'invalid review' using errcode = '22023';
  end if;
  delete from public.ai_quality_reviews r where r.tenant_id = v_tenant and r.message_id = any (p_messages);
  get diagnostics v_count = row_count;
  return v_count;
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
    'public.analytics_overview(text, integer)',
    'public.quality_gaps(text, integer, text, text, integer)',
    'public.quality_flagged(text, text, integer, text, text, integer)',
    'public.quality_summary(text, integer)',
    'public.quality_review_save(text, uuid[], text, text)',
    'public.quality_review_reopen(text, uuid[])'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
