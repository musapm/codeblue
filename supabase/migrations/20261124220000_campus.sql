-- UniAgent AI · Phase 12 · Migration 18: campus map and assistant.
--
-- * Campus locations (buildings, offices, rooms, services) with codes, Arabic names, the
--   building and floor they are in, the department behind them, coordinates for a simple map,
--   weekly opening hours, accessibility facts (yes / no / not known) and contact details.
--   Managed with campus.manage; members of a university with the campus_assistant feature
--   see published locations. Locations are not personal data: they are audited.
-- * Search ignores case, Arabic letter variants, diacritics and punctuation, and ranks by how
--   many words of the query a location matches (names, codes, aliases, descriptions).
-- * The optional AI campus answers are grounded in the matching location records only; they
--   are booked as feature 'campus_assistant' with their own switch, budget and daily limit.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Same folding as app.normalize_question, without its length cut.
create or replace function app.campus_normalize(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(p, '')), 'أإآىة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ـ', 'ااايه01234567890123456789'),
      '[' || chr(1611) || '-' || chr(1618) || ']', '', 'g'),
    '[[:punct:][:space:]؟،؛«»“”‘’…–—]+', ' ', 'g'));
$$;

-- Weekly hours: {"mon": [["08:00", "16:00"]], …}; up to 3 ranges a day; a day left out is closed.
create or replace function app.campus_hours_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  r jsonb;
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') or jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 3 then
      return false;
    end if;
    for r in select x from jsonb_array_elements(p -> k) as x loop
      if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 2
         or coalesce(r ->> 0, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(r ->> 1, '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
         or (r ->> 0) >= (r ->> 1) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- Accessibility facts: known keys only, each true or false (left out: not known).
create or replace function app.campus_access_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each(p) e
    where e.key not in ('step_free_entrance', 'elevator', 'accessible_toilet', 'accessible_parking', 'hearing_loop', 'braille_signage')
       or jsonb_typeof(e.value) <> 'boolean'
  ));
$$;

create or replace function app.campus_aliases_valid(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(p) <= 20 and coalesce((select bool_and(char_length(btrim(a)) between 1 and 80) from unnest(p) a), true);
$$;

revoke all on function app.campus_normalize(text), app.campus_hours_valid(jsonb), app.campus_access_valid(jsonb), app.campus_aliases_valid(text[]) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.campus_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null constraint campus_locations_kind check (kind in (
    'building', 'office', 'classroom', 'lab', 'library', 'cafeteria', 'clinic', 'prayer_room',
    'parking', 'gate', 'sports', 'residence', 'service', 'other'
  )),
  name text not null constraint campus_locations_name check (char_length(btrim(name)) between 2 and 160),
  name_ar text constraint campus_locations_name_ar check (name_ar is null or char_length(btrim(name_ar)) between 2 and 160),
  code text constraint campus_locations_code check (code is null or code ~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,19}$'),
  description text constraint campus_locations_description check (description is null or char_length(description) <= 1000),
  description_ar text constraint campus_locations_description_ar check (description_ar is null or char_length(description_ar) <= 1000),
  -- The building it is in (only buildings can contain locations).
  parent_id uuid,
  floor text constraint campus_locations_floor check (floor is null or char_length(btrim(floor)) between 1 and 20),
  department_id uuid,
  latitude numeric(9, 6) constraint campus_locations_latitude check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) constraint campus_locations_longitude check (longitude is null or longitude between -180 and 180),
  opening_hours jsonb constraint campus_locations_hours check (app.campus_hours_valid(opening_hours)),
  hours_note text constraint campus_locations_hours_note check (hours_note is null or char_length(hours_note) <= 300),
  hours_note_ar text constraint campus_locations_hours_note_ar check (hours_note_ar is null or char_length(hours_note_ar) <= 300),
  accessibility jsonb not null default '{}'::jsonb constraint campus_locations_access check (app.campus_access_valid(accessibility)),
  accessibility_note text constraint campus_locations_access_note check (accessibility_note is null or char_length(accessibility_note) <= 500),
  accessibility_note_ar text constraint campus_locations_access_note_ar check (accessibility_note_ar is null or char_length(accessibility_note_ar) <= 500),
  phone text constraint campus_locations_phone check (phone is null or phone ~ '^\+?[0-9() .-]{6,32}$'),
  email text constraint campus_locations_email check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  url text constraint campus_locations_url check (url is null or (char_length(url) <= 500 and url ~ '^https://[^[:space:]]+$')),
  aliases text[] not null default '{}' constraint campus_locations_aliases check (app.campus_aliases_valid(aliases)),
  published boolean not null default false,
  -- Maintained by a trigger (folded names, code, aliases and descriptions).
  search_text text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campus_locations_coordinates check ((latitude is null) = (longitude is null)),
  constraint campus_locations_not_own_parent check (parent_id is null or parent_id <> id),
  unique (tenant_id, id),
  foreign key (tenant_id, parent_id) references public.campus_locations (tenant_id, id) on delete set null (parent_id),
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id) on delete set null (department_id)
);
create index campus_locations_tenant_idx on public.campus_locations (tenant_id, published, kind);
create index campus_locations_parent_idx on public.campus_locations (parent_id);

create table public.campus_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  ai_enabled boolean not null default false,
  monthly_budget_usd numeric(10, 2) not null default 5
    constraint campus_settings_budget check (monthly_budget_usd >= 0 and monthly_budget_usd <= 100000),
  daily_limit integer not null default 30 constraint campus_settings_daily_limit check (daily_limit between 1 and 200),
  updated_at timestamptz not null default now()
);

create or replace function app.campus_search_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text := app.campus_normalize(
    coalesce(new.name, '') || ' ' || coalesce(new.name_ar, '') || ' ' || coalesce(new.code, '') || ' '
    || array_to_string(new.aliases, ' ') || ' ' || coalesce(new.description, '') || ' ' || coalesce(new.description_ar, ''));
  return new;
end;
$$;

create trigger campus_locations_search before insert or update on public.campus_locations
  for each row execute function app.campus_search_text();
create trigger campus_locations_updated_at before update on public.campus_locations
  for each row execute function app.set_updated_at();
create trigger campus_settings_updated_at before update on public.campus_settings
  for each row execute function app.set_updated_at();
create trigger campus_locations_audit after insert or update or delete on public.campus_locations
  for each row execute function app.audit_row_change();
create trigger campus_settings_audit after insert or update or delete on public.campus_settings
  for each row execute function app.audit_row_change();

alter table public.campus_locations enable row level security;
alter table public.campus_settings enable row level security;
revoke all on table public.campus_locations, public.campus_settings from anon, authenticated;
grant select on table public.campus_locations, public.campus_settings to authenticated;

create policy campus_locations_select on public.campus_locations for select to authenticated
  using (app.is_tenant_member(tenant_id) and app.tenant_has_feature(tenant_id, 'campus_assistant')
         and (published or app.has_permission(tenant_id, 'campus.manage')));
create policy campus_settings_select on public.campus_settings for select to authenticated
  using (app.has_permission(tenant_id, 'assistant.configure'));

-- ---------------------------------------------------------------------------
-- API: locations (campus.manage)
-- ---------------------------------------------------------------------------

-- Create (p_location null) or update a location from a JSON object of its fields.
create or replace function public.campus_save_location(p_tenant_slug text, p_location uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_parent uuid := nullif(p_data ->> 'parent_id', '')::uuid;
  v_kind text := p_data ->> 'kind';
  v_id uuid;
  v_aliases text[];
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'campus.manage') or not app.tenant_has_feature(v_tenant, 'campus_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid location' using errcode = '22023';
  end if;
  -- Only buildings contain locations, and buildings are not inside anything.
  if v_parent is not null and (v_kind = 'building' or v_parent = p_location or not exists (
    select 1 from public.campus_locations b where b.id = v_parent and b.tenant_id = v_tenant and b.kind = 'building'
  )) then
    raise exception 'invalid building' using errcode = '22023';
  end if;
  if v_kind <> 'building' and p_location is not null and exists (select 1 from public.campus_locations c where c.parent_id = p_location) then
    raise exception 'a location with rooms inside must stay a building' using errcode = '22023';
  end if;
  select coalesce(array_agg(btrim(a)) filter (where btrim(a) <> ''), '{}') into v_aliases
  from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'aliases') = 'array' then p_data -> 'aliases' else '[]'::jsonb end) a;

  if p_location is null then
    insert into public.campus_locations (tenant_id, kind, name, created_by) values (v_tenant, v_kind, btrim(p_data ->> 'name'), auth.uid())
    returning id into v_id;
  else
    select id into v_id from public.campus_locations where id = p_location and tenant_id = v_tenant;
    if v_id is null then
      raise exception 'location not found' using errcode = 'P0002';
    end if;
  end if;

  update public.campus_locations set
    kind = v_kind,
    name = btrim(p_data ->> 'name'),
    name_ar = nullif(btrim(p_data ->> 'name_ar'), ''),
    code = nullif(btrim(p_data ->> 'code'), ''),
    description = nullif(btrim(p_data ->> 'description'), ''),
    description_ar = nullif(btrim(p_data ->> 'description_ar'), ''),
    parent_id = v_parent,
    floor = nullif(btrim(p_data ->> 'floor'), ''),
    department_id = nullif(p_data ->> 'department_id', '')::uuid,
    latitude = nullif(p_data ->> 'latitude', '')::numeric,
    longitude = nullif(p_data ->> 'longitude', '')::numeric,
    opening_hours = case when jsonb_typeof(p_data -> 'opening_hours') = 'object' then p_data -> 'opening_hours' end,
    hours_note = nullif(btrim(p_data ->> 'hours_note'), ''),
    hours_note_ar = nullif(btrim(p_data ->> 'hours_note_ar'), ''),
    accessibility = case when jsonb_typeof(p_data -> 'accessibility') = 'object' then p_data -> 'accessibility' else '{}'::jsonb end,
    accessibility_note = nullif(btrim(p_data ->> 'accessibility_note'), ''),
    accessibility_note_ar = nullif(btrim(p_data ->> 'accessibility_note_ar'), ''),
    phone = nullif(btrim(p_data ->> 'phone'), ''),
    email = nullif(lower(btrim(p_data ->> 'email')), ''),
    url = nullif(btrim(p_data ->> 'url'), ''),
    aliases = v_aliases
  where id = v_id;
  return v_id;
end;
$$;

create or replace function public.campus_set_published(p_location uuid, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.campus_locations;
begin
  select * into l from public.campus_locations where id = p_location;
  if l.id is null or not app.has_permission(l.tenant_id, 'campus.manage') or not app.tenant_has_feature(l.tenant_id, 'campus_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.campus_locations set published = coalesce(p_published, false) where id = l.id;
end;
$$;

-- Deleting a building keeps the locations inside it (they lose their building).
create or replace function public.campus_delete_location(p_location uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.campus_locations;
begin
  select * into l from public.campus_locations where id = p_location;
  if l.id is null or not app.has_permission(l.tenant_id, 'campus.manage') or not app.tenant_has_feature(l.tenant_id, 'campus_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.campus_locations where id = l.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- API: search (members)
-- ---------------------------------------------------------------------------

-- Published locations ranked by the number of query words they contain (any word counts; a
-- name that equals the query ranks first). Common question words are ignored.
create or replace function public.campus_search(p_tenant_slug text, p_query text, p_kind text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_query text := app.campus_normalize(left(coalesce(p_query, ''), 300));
  v_words text[];
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) or not app.tenant_has_feature(v_tenant, 'campus_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct w), '{}') into v_words
  from unnest(string_to_array(v_query, ' ')) as w
  where char_length(w) >= 2 and w not in (
    'the', 'is', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'where', 'what', 'when', 'how', 'which', 'who', 'can',
    'do', 'does', 'i', 'me', 'my', 'find', 'there', 'are', 'it', 'and', 'or', 'with', 'near', 'open', 'opening', 'hours',
    'time', 'today', 'now', 'please', 'get', 'go', 'any', 'have', 'has',
    'في', 'من', 'الي', 'علي', 'عن', 'هل', 'ما', 'ماذا', 'اين', 'متي', 'كيف', 'هو', 'هي', 'مكان', 'يوجد', 'اريد', 'ابحث',
    'مفتوح', 'مفتوحه', 'يفتح', 'تفتح', 'الان', 'اليوم', 'لو', 'سمحت', 'او', 'و'
  );
  return coalesce((
    select jsonb_agg((to_jsonb(r) - 'search_text' - 'created_by' - 'score') || jsonb_build_object('score', r.score) order by r.score desc, r.name)
    from (
      select l.*,
             (select count(*) from unnest(v_words) w where l.search_text like '%' || w || '%')
             + case when v_query <> '' and (app.campus_normalize(l.name) = v_query or app.campus_normalize(l.name_ar) = v_query
                                            or app.campus_normalize(l.code) = v_query) then 5 else 0 end as score
      from public.campus_locations l
      where l.tenant_id = v_tenant and l.published and (p_kind is null or l.kind = p_kind)
      order by 2 desc
    ) r
    where cardinality(v_words) = 0 or r.score > 0
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- API: settings and the AI campus answers
-- ---------------------------------------------------------------------------

create or replace function public.campus_status(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.campus_settings;
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.campus_settings where tenant_id = v_tenant;
  return jsonb_build_object(
    'feature', app.tenant_has_feature(v_tenant, 'campus_assistant'),
    'ai_enabled', coalesce(s.ai_enabled, false),
    'ai_within_budget', s.tenant_id is not null and app.ai_month_cost(v_tenant, 'campus_assistant') < s.monthly_budget_usd
  );
end;
$$;

create or replace function public.campus_update_settings(p_tenant_slug text, p_ai_enabled boolean, p_monthly_budget_usd numeric, p_daily_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.configure') or not app.tenant_has_feature(v_tenant, 'campus_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.campus_settings (tenant_id, ai_enabled, monthly_budget_usd, daily_limit)
  values (v_tenant, coalesce(p_ai_enabled, false), p_monthly_budget_usd, p_daily_limit)
  on conflict (tenant_id) do update
    set ai_enabled = excluded.ai_enabled, monthly_budget_usd = excluded.monthly_budget_usd, daily_limit = excluded.daily_limit;
end;
$$;

create or replace function public.campus_ai_begin(p_tenant_slug text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.campus_settings;
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) or not app.tenant_has_feature(v_tenant, 'campus_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.campus_settings where tenant_id = v_tenant;
  if s.tenant_id is null or not s.ai_enabled then
    raise exception 'campus answers are turned off' using errcode = '55000';
  end if;
  if app.ai_month_cost(v_tenant, 'campus_assistant') >= s.monthly_budget_usd then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if (select count(*) from public.ai_usage_events u
      where u.tenant_id = v_tenant and u.user_id = auth.uid() and u.feature = 'campus_assistant' and u.created_at > now() - interval '24 hours')
     >= s.daily_limit then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;
end;
$$;

create or replace function public.campus_ai_record(p_tenant_slug text, p_model text, p_usage jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.is_tenant_member(v_tenant) or not app.tenant_has_feature(v_tenant, 'campus_assistant') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.ai_usage_events (tenant_id, user_id, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
  values (v_tenant, auth.uid(), 'campus_assistant', p_model,
          coalesce((p_usage ->> 'input_tokens')::integer, 0), coalesce((p_usage ->> 'output_tokens')::integer, 0),
          coalesce((p_usage ->> 'cache_read_tokens')::integer, 0), coalesce((p_usage ->> 'cache_write_tokens')::integer, 0),
          coalesce((p_usage ->> 'cost_usd')::numeric, 0));
end;
$$;

create or replace function public.campus_usage(p_tenant_slug text)
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
    'locations', (select count(*) from public.campus_locations l where l.tenant_id = v_tenant),
    'published', (select count(*) from public.campus_locations l where l.tenant_id = v_tenant and l.published),
    'questions', (select count(*) from public.ai_usage_events u where u.tenant_id = v_tenant and u.feature = 'campus_assistant' and u.created_at >= v_since),
    'cost_usd', app.ai_month_cost(v_tenant, 'campus_assistant')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics: the campus answers' AI cost and budget (replaces migration 17's)
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
    'public.campus_save_location(text, uuid, jsonb)',
    'public.campus_set_published(uuid, boolean)',
    'public.campus_delete_location(uuid)',
    'public.campus_search(text, text, text, integer)',
    'public.campus_status(text)',
    'public.campus_update_settings(text, boolean, numeric, integer)',
    'public.campus_ai_begin(text)',
    'public.campus_ai_record(text, text, jsonb)',
    'public.campus_usage(text)',
    'public.analytics_overview(text, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
