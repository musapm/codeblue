-- UniAgent AI · Phase 6 · Migration 11: admissions (programs, public assistant, consented leads).
--
-- * Programs: managed by staff with programs.manage; only published programs are public.
-- * Public visitors: read the public admissions page through public_admissions() (no session
--   needed). Asking the admissions assistant or sending an inquiry needs a session: visitors
--   get an anonymous Supabase session (ADR-025), so every write has an owner and per-visitor
--   limits. CAPTCHA (Turnstile) is enforced by Supabase Auth when sessions are created.
-- * Leads: personal data. Readable with leads.read, changed with leads.manage, always with the
--   consent record (time, wording, version). Lead rows are NOT copied into the append-only audit
--   log (it stores whole rows); their history lives in admission_lead_events, which is deleted
--   with the lead, and the audit log only records PII-free facts (reference, action).
-- * The admissions assistant reuses the assistant conversation tables with agent = 'admissions';
--   visitors see only their own conversations, and staff cannot read them.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function app.tenant_is_operating(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tenants t where t.id = p_tenant and t.status in ('trial', 'active'));
$$;

-- Estimated AI spend of one feature in the current month (budgets are per agent).
create or replace function app.ai_month_cost(p_tenant uuid, p_feature text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0)
  from public.ai_usage_events u
  where u.tenant_id = p_tenant and u.feature = p_feature and u.created_at >= date_trunc('month', now());
$$;

-- The student assistant budget now counts only the student assistant's own spend.
create or replace function app.assistant_month_cost(p_tenant uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select app.ai_month_cost(p_tenant, 'student_assistant');
$$;

-- Does an active member hold one of these permissions? (For assignment targets, not the caller.)
create or replace function app.member_has_any_permission(p_tenant uuid, p_user uuid, p_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
    where m.tenant_id = p_tenant and m.user_id = p_user and m.status = 'active'
      and rp.permission_key = any (p_permissions)
  );
$$;

-- PII-free audit entry written by functions (the generic row trigger would copy personal data).
create or replace function app.audit_fact(p_tenant uuid, p_action text, p_target_type text, p_target_id text, p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into public.audit_logs (tenant_id, actor_id, actor_type, action, target_type, target_id, metadata)
  values (
    p_tenant,
    v_actor,
    case
      when v_actor is null then 'system'
      when exists (select 1 from public.platform_admins pa where pa.user_id = v_actor) then 'platform_admin'
      else 'user'
    end,
    p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function app.tenant_is_operating(uuid), app.ai_month_cost(uuid, text),
  app.member_has_any_permission(uuid, uuid, text[]), app.audit_fact(uuid, text, text, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.admissions_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  -- Public admissions page: programs and the inquiry form.
  public_enabled boolean not null default false,
  contact_email text constraint admissions_settings_contact check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),
  privacy_url text constraint admissions_settings_privacy check (privacy_url is null or (char_length(privacy_url) <= 500 and privacy_url ~ '^https://')),
  welcome text constraint admissions_settings_welcome check (welcome is null or char_length(welcome) <= 500),
  welcome_ar text constraint admissions_settings_welcome_ar check (welcome_ar is null or char_length(welcome_ar) <= 500),
  -- Consent wording shown on the inquiry form; null = the platform's default wording.
  consent_text text constraint admissions_settings_consent check (consent_text is null or char_length(consent_text) between 20 and 1000),
  consent_text_ar text constraint admissions_settings_consent_ar check (consent_text_ar is null or char_length(consent_text_ar) between 20 and 1000),
  consent_version integer not null default 1 constraint admissions_settings_consent_version check (consent_version >= 1),
  -- Public AI assistant (spends money: separate switch, budget and per-visitor limit).
  assistant_enabled boolean not null default false,
  assistant_instructions text constraint admissions_settings_instructions check (assistant_instructions is null or char_length(assistant_instructions) <= 2000),
  monthly_budget_usd numeric(10, 2) not null default 20
    constraint admissions_settings_budget check (monthly_budget_usd >= 0 and monthly_budget_usd <= 100000),
  daily_questions_per_visitor integer not null default 20
    constraint admissions_settings_daily check (daily_questions_per_visitor between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.admission_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null constraint admission_programs_code check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  name text not null constraint admission_programs_name check (char_length(btrim(name)) between 2 and 160),
  name_ar text constraint admission_programs_name_ar check (name_ar is null or char_length(name_ar) <= 160),
  level text not null default 'bachelor'
    constraint admission_programs_level check (level in ('certificate', 'diploma', 'bachelor', 'master', 'doctorate', 'other')),
  department_id uuid,
  description text constraint admission_programs_description check (description is null or char_length(description) <= 4000),
  description_ar text constraint admission_programs_description_ar check (description_ar is null or char_length(description_ar) <= 4000),
  requirements text constraint admission_programs_requirements check (requirements is null or char_length(requirements) <= 4000),
  requirements_ar text constraint admission_programs_requirements_ar check (requirements_ar is null or char_length(requirements_ar) <= 4000),
  duration_months smallint constraint admission_programs_duration check (duration_months is null or duration_months between 1 and 120),
  study_mode text constraint admission_programs_mode check (study_mode is null or study_mode in ('full_time', 'part_time', 'online', 'blended')),
  teaching_language text constraint admission_programs_language check (teaching_language is null or teaching_language in ('en', 'ar', 'mixed')),
  intakes text constraint admission_programs_intakes check (intakes is null or char_length(intakes) <= 200),
  intakes_ar text constraint admission_programs_intakes_ar check (intakes_ar is null or char_length(intakes_ar) <= 200),
  tuition_amount numeric(12, 2) constraint admission_programs_tuition check (tuition_amount is null or tuition_amount >= 0),
  tuition_currency text constraint admission_programs_currency check (tuition_currency is null or tuition_currency ~ '^[A-Z]{3}$'),
  tuition_period text constraint admission_programs_period check (tuition_period is null or tuition_period in ('year', 'semester', 'credit_hour', 'total')),
  tuition_note text constraint admission_programs_tuition_note check (tuition_note is null or char_length(tuition_note) <= 500),
  tuition_note_ar text constraint admission_programs_tuition_note_ar check (tuition_note_ar is null or char_length(tuition_note_ar) <= 500),
  application_deadline date,
  application_url text constraint admission_programs_url check (application_url is null or (char_length(application_url) <= 500 and application_url ~ '^https://')),
  status text not null default 'draft' constraint admission_programs_status check (status in ('draft', 'published', 'archived')),
  sort_order smallint not null default 0,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admission_programs_tuition_complete check (tuition_amount is null or (tuition_currency is not null and tuition_period is not null)),
  unique (tenant_id, code),
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id)
);
create index admission_programs_tenant_idx on public.admission_programs (tenant_id, status, sort_order);

create table public.admission_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reference text not null constraint admission_leads_reference check (reference ~ '^L-[0-9]{5,}$'),
  full_name text not null constraint admission_leads_name check (char_length(btrim(full_name)) between 2 and 120),
  email text constraint admission_leads_email check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),
  phone text constraint admission_leads_phone check (phone is null or phone ~ '^[+]?[0-9 ()-]{6,32}$'),
  country text constraint admission_leads_country check (country is null or char_length(country) <= 80),
  program_id uuid,
  intake text constraint admission_leads_intake check (intake is null or char_length(intake) <= 60),
  message text constraint admission_leads_message check (message is null or char_length(message) <= 2000),
  locale text not null default 'en' constraint admission_leads_locale check (locale in ('en', 'ar')),
  source text not null constraint admission_leads_source check (source in ('form', 'assistant', 'manual')),
  stage text not null default 'new'
    constraint admission_leads_stage check (stage in ('new', 'contacted', 'qualified', 'applied', 'admitted', 'enrolled', 'lost')),
  lost_reason text constraint admission_leads_lost_reason check (lost_reason is null or char_length(lost_reason) <= 300),
  assigned_to uuid references auth.users (id) on delete set null,
  -- Consent record: when, which wording (exact text as shown) and which version.
  consent_at timestamptz not null,
  consent_version text not null constraint admission_leads_consent_version check (char_length(consent_version) between 1 and 40),
  consent_text text not null constraint admission_leads_consent_text check (char_length(consent_text) between 10 and 2000),
  submitted_by uuid references auth.users (id) on delete set null,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admission_leads_contact check (email is not null or phone is not null),
  unique (tenant_id, reference),
  unique (tenant_id, id),
  foreign key (tenant_id, program_id) references public.admission_programs (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.assistant_conversations (tenant_id, id) on delete set null (conversation_id)
);
create index admission_leads_tenant_idx on public.admission_leads (tenant_id, created_at desc);
create index admission_leads_stage_idx on public.admission_leads (tenant_id, stage);
create index admission_leads_submitter_idx on public.admission_leads (submitted_by, created_at);

create table public.admission_lead_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  lead_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  body text not null constraint admission_lead_notes_body check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.admission_leads (tenant_id, id) on delete cascade
);
create index admission_lead_notes_lead_idx on public.admission_lead_notes (lead_id, created_at);

create table public.admission_lead_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  lead_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null constraint admission_lead_events_kind check (kind in ('created', 'stage', 'assigned', 'program', 'note')),
  from_value text constraint admission_lead_events_from check (from_value is null or char_length(from_value) <= 200),
  to_value text constraint admission_lead_events_to check (to_value is null or char_length(to_value) <= 200),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.admission_leads (tenant_id, id) on delete cascade
);
create index admission_lead_events_lead_idx on public.admission_lead_events (lead_id, created_at);

-- Per-university lead numbers (L-00001, …).
create table app.admission_lead_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number integer not null default 0
);
alter table app.admission_lead_counters enable row level security;
revoke all on table app.admission_lead_counters from public;

-- Assistant conversations now belong to an agent.
alter table public.assistant_conversations
  add column agent text not null default 'student' constraint assistant_conversations_agent check (agent in ('student', 'admissions'));
create index assistant_conversations_agent_idx on public.assistant_conversations (tenant_id, agent, created_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function app.admission_programs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
  elsif new.status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app.admission_programs_touch() from public;

create trigger admission_programs_publish before insert or update on public.admission_programs
  for each row execute function app.admission_programs_touch();
create trigger admission_programs_updated_at before update on public.admission_programs
  for each row execute function app.set_updated_at();
create trigger admission_leads_updated_at before update on public.admission_leads
  for each row execute function app.set_updated_at();
create trigger admissions_settings_updated_at before update on public.admissions_settings
  for each row execute function app.set_updated_at();
-- Programs and settings contain no personal data: the generic audit trigger is fine.
create trigger admission_programs_audit after insert or update or delete on public.admission_programs
  for each row execute function app.audit_row_change();
create trigger admissions_settings_audit after insert or update or delete on public.admissions_settings
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.admissions_settings enable row level security;
alter table public.admission_programs enable row level security;
alter table public.admission_leads enable row level security;
alter table public.admission_lead_notes enable row level security;
alter table public.admission_lead_events enable row level security;

revoke all on table public.admissions_settings, public.admission_programs, public.admission_leads,
  public.admission_lead_notes, public.admission_lead_events from anon, authenticated;
grant select on table public.admissions_settings, public.admission_leads, public.admission_lead_notes,
  public.admission_lead_events to authenticated;
grant select, insert, update, delete on table public.admission_programs to authenticated;

create policy admissions_settings_select on public.admissions_settings for select to authenticated
  using (
    app.has_permission(tenant_id, 'programs.manage') or app.has_permission(tenant_id, 'assistant.configure')
    or app.has_permission(tenant_id, 'leads.read')
  );

create policy admission_programs_select on public.admission_programs for select to authenticated
  using (
    app.tenant_has_feature(tenant_id, 'admissions_agent')
    and (app.has_permission(tenant_id, 'programs.manage') or app.has_permission(tenant_id, 'leads.read'))
  );
create policy admission_programs_insert on public.admission_programs for insert to authenticated
  with check (app.has_permission(tenant_id, 'programs.manage') and app.tenant_has_feature(tenant_id, 'admissions_agent'));
create policy admission_programs_update on public.admission_programs for update to authenticated
  using (app.has_permission(tenant_id, 'programs.manage') and app.tenant_has_feature(tenant_id, 'admissions_agent'))
  with check (app.has_permission(tenant_id, 'programs.manage') and app.tenant_has_feature(tenant_id, 'admissions_agent'));
create policy admission_programs_delete on public.admission_programs for delete to authenticated
  using (app.has_permission(tenant_id, 'programs.manage') and app.tenant_has_feature(tenant_id, 'admissions_agent'));

create policy admission_leads_select on public.admission_leads for select to authenticated
  using (app.has_permission(tenant_id, 'leads.read') and app.tenant_has_feature(tenant_id, 'admissions_agent'));
create policy admission_lead_notes_select on public.admission_lead_notes for select to authenticated
  using (app.has_permission(tenant_id, 'leads.read') and app.tenant_has_feature(tenant_id, 'admissions_agent'));
create policy admission_lead_events_select on public.admission_lead_events for select to authenticated
  using (app.has_permission(tenant_id, 'leads.read') and app.tenant_has_feature(tenant_id, 'admissions_agent'));

-- Visitors (often anonymous sessions) see their own admissions conversations; staff do not.
alter policy assistant_conversations_select on public.assistant_conversations
  using (user_id = auth.uid() and (agent = 'admissions' or app.is_tenant_member(tenant_id)));
alter policy assistant_messages_select on public.assistant_messages
  using (exists (
    select 1 from public.assistant_conversations c
    where c.id = conversation_id and c.user_id = auth.uid() and (c.agent = 'admissions' or app.is_tenant_member(c.tenant_id))
  ));

-- ---------------------------------------------------------------------------
-- Public read (no session needed)
-- ---------------------------------------------------------------------------

-- The public admissions page of a university, or null when it is not available (unknown,
-- suspended, feature off or page not published all look the same).
create or replace function public.public_admissions(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.admissions_settings;
begin
  if v_tenant is null or not app.tenant_is_operating(v_tenant) or not app.tenant_has_feature(v_tenant, 'admissions_agent') then
    return null;
  end if;
  select * into s from public.admissions_settings where tenant_id = v_tenant;
  if s.tenant_id is null or not s.public_enabled then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'tenant', jsonb_build_object('slug', t.slug, 'name', t.name, 'name_translations', t.name_translations, 'default_locale', t.default_locale),
      'branding', coalesce(b.published, '{}'::jsonb),
      'settings', jsonb_build_object(
        'assistant_enabled', s.assistant_enabled,
        'contact_email', coalesce(s.contact_email, ts.support_email),
        'privacy_url', s.privacy_url,
        'welcome', s.welcome,
        'welcome_ar', s.welcome_ar,
        'consent_text', s.consent_text,
        'consent_text_ar', s.consent_text_ar,
        'consent_version', s.consent_version
      ),
      'programs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'code', p.code, 'name', p.name, 'name_ar', p.name_ar, 'level', p.level,
          'department', d.name, 'department_ar', d.name_translations ->> 'ar',
          'description', p.description, 'description_ar', p.description_ar,
          'requirements', p.requirements, 'requirements_ar', p.requirements_ar,
          'duration_months', p.duration_months, 'study_mode', p.study_mode, 'teaching_language', p.teaching_language,
          'intakes', p.intakes, 'intakes_ar', p.intakes_ar,
          'tuition_amount', p.tuition_amount, 'tuition_currency', p.tuition_currency, 'tuition_period', p.tuition_period,
          'tuition_note', p.tuition_note, 'tuition_note_ar', p.tuition_note_ar,
          'application_deadline', p.application_deadline, 'application_url', p.application_url,
          'updated_at', p.updated_at
        ) order by p.sort_order, p.name)
        from public.admission_programs p
        left join public.departments d on d.tenant_id = p.tenant_id and d.id = p.department_id
        where p.tenant_id = v_tenant and p.status = 'published'
      ), '[]'::jsonb)
    )
    from public.tenants t
    left join public.tenant_branding b on b.tenant_id = t.id
    left join public.tenant_settings ts on ts.tenant_id = t.id
    where t.id = v_tenant
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Visitors: inquiries (leads) and the admissions assistant
-- ---------------------------------------------------------------------------

-- Is the public admissions page (and, optionally, its assistant) available right now?
create or replace function app.admissions_open(p_tenant uuid, p_assistant boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.tenant_is_operating(p_tenant)
    and app.tenant_has_feature(p_tenant, 'admissions_agent')
    and exists (
      select 1 from public.admissions_settings s
      where s.tenant_id = p_tenant and s.public_enabled and (not p_assistant or s.assistant_enabled)
    );
$$;
revoke all on function app.admissions_open(uuid, boolean) from public;

-- Next lead reference for a university.
create or replace function app.next_lead_reference(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into app.admission_lead_counters as c (tenant_id, last_number) values (p_tenant, 1)
  on conflict (tenant_id) do update set last_number = c.last_number + 1
  returning last_number into v_n;
  return 'L-' || lpad(v_n::text, 5, '0');
end;
$$;
revoke all on function app.next_lead_reference(uuid) from public;

-- A visitor's inquiry with explicit consent. Any session may call it (anonymous included);
-- at most 3 inquiries per visitor and university per 24 hours.
create or replace function public.admissions_submit_lead(
  p_tenant_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_country text,
  p_program uuid,
  p_intake text,
  p_message text,
  p_locale text,
  p_consent_version text,
  p_consent_text text,
  p_conversation uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  s public.admissions_settings;
  v_lead uuid;
  v_reference text;
begin
  if auth.uid() is null or v_tenant is null or not app.admissions_open(v_tenant, false) then
    raise exception 'not available' using errcode = '42501';
  end if;
  -- The consent record must be the wording the university shows: its own wording (exact text
  -- and current version), or, when it has none, the platform default version (whose text lives
  -- in the application).
  select * into s from public.admissions_settings where tenant_id = v_tenant;
  if s.consent_text is not null or s.consent_text_ar is not null then
    if p_consent_version is distinct from s.consent_version::text
       or p_consent_text is null or p_consent_text not in (coalesce(s.consent_text, ''), coalesce(s.consent_text_ar, '')) then
      raise exception 'consent wording does not match' using errcode = '22023';
    end if;
  elsif p_consent_version is distinct from 'default-1' then
    raise exception 'consent wording does not match' using errcode = '22023';
  end if;
  if (
    select count(*) from public.admission_leads l
    where l.tenant_id = v_tenant and l.submitted_by = auth.uid() and l.created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'too many inquiries' using errcode = '54000';
  end if;
  if p_program is not null and not exists (
    select 1 from public.admission_programs p where p.id = p_program and p.tenant_id = v_tenant and p.status = 'published'
  ) then
    raise exception 'program not found' using errcode = '22023';
  end if;
  if p_conversation is not null and not exists (
    select 1 from public.assistant_conversations c
    where c.id = p_conversation and c.tenant_id = v_tenant and c.user_id = auth.uid() and c.agent = 'admissions'
  ) then
    raise exception 'conversation not found' using errcode = '22023';
  end if;

  v_reference := app.next_lead_reference(v_tenant);
  insert into public.admission_leads (tenant_id, reference, full_name, email, phone, country, program_id, intake, message, locale,
                                      source, consent_at, consent_version, consent_text, submitted_by, conversation_id)
  values (v_tenant, v_reference, btrim(p_full_name), nullif(lower(btrim(p_email)), ''), nullif(btrim(p_phone), ''),
          nullif(btrim(p_country), ''), p_program, nullif(btrim(p_intake), ''), nullif(btrim(p_message), ''),
          coalesce(p_locale, 'en'), case when p_conversation is null then 'form' else 'assistant' end,
          now(), p_consent_version, p_consent_text, auth.uid(), p_conversation)
  returning id into v_lead;
  insert into public.admission_lead_events (tenant_id, lead_id, actor_id, kind, to_value)
  values (v_tenant, v_lead, auth.uid(), 'created', case when p_conversation is null then 'form' else 'assistant' end);
  return jsonb_build_object('reference', v_reference);
end;
$$;

-- Public knowledge for the admissions assistant: published documents with visibility "public".
create or replace function public.admissions_search(p_tenant_slug text, p_query text, p_limit integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_query tsquery := app.knowledge_tsquery(p_query);
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 12);
begin
  if auth.uid() is null or v_tenant is null or not app.admissions_open(v_tenant, true) then
    raise exception 'not available' using errcode = '42501';
  end if;
  if v_query is null or not app.tenant_has_feature(v_tenant, 'knowledge_base') then
    return '[]'::jsonb;
  end if;
  return coalesce((
    with readable as (
      select d.id, d.title, d.title_ar, d.is_authoritative, d.source_priority, d.current_version_id
      from public.knowledge_documents d
      where d.tenant_id = v_tenant
        and d.visibility = 'public'
        and d.published_at is not null
        and d.current_version_id is not null
        and d.archived_at is null
        and (d.expiry_date is null or d.expiry_date >= current_date)
    ),
    ranked as (
      select c.id, c.document_id, c.page_from, c.page_to, c.heading, c.content, r.title, r.title_ar,
             (select v.version_no from public.knowledge_document_versions v where v.id = c.version_id) as version_no,
             ts_rank_cd(c.search_tsv, v_query, 1) * (case when r.is_authoritative then 1.25 else 1.0 end) * (0.75 + r.source_priority / 200.0) as score
      from public.knowledge_chunks c
      join readable r on r.id = c.document_id and r.current_version_id = c.version_id
      where c.tenant_id = v_tenant and c.search_tsv @@ v_query
      order by score desc, c.id
      limit v_limit
    )
    select jsonb_agg(jsonb_build_object(
      'chunk_id', id, 'document_id', document_id, 'version_no', version_no, 'title', title, 'title_ar', title_ar,
      'page_from', page_from, 'page_to', page_to, 'heading', heading, 'content', content, 'score', round(score::numeric, 6)
    ) order by score desc, id)
    from ranked
  ), '[]'::jsonb);
end;
$$;

-- Start an admissions assistant turn (any session; per-visitor daily limit; per-university budget).
create or replace function public.admissions_begin_turn(p_tenant_slug text, p_conversation uuid, p_question text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_conversation uuid := p_conversation;
  v_question text := btrim(coalesce(p_question, ''));
  s public.admissions_settings;
  v_history jsonb;
begin
  if auth.uid() is null or v_tenant is null or not app.tenant_is_operating(v_tenant)
     or not app.tenant_has_feature(v_tenant, 'admissions_agent') then
    raise exception 'not available' using errcode = '42501';
  end if;
  select * into s from public.admissions_settings where tenant_id = v_tenant;
  if s.tenant_id is null or not s.public_enabled or not s.assistant_enabled then
    raise exception 'assistant is turned off' using errcode = '55000';
  end if;
  if app.ai_month_cost(v_tenant, 'admissions_agent') >= s.monthly_budget_usd then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if char_length(v_question) < 2 or char_length(v_question) > 1000 then
    raise exception 'invalid question' using errcode = '22023';
  end if;
  if (
    select count(*) from public.assistant_messages m
    join public.assistant_conversations c on c.id = m.conversation_id
    where c.tenant_id = v_tenant and c.user_id = auth.uid() and c.agent = 'admissions'
      and m.role = 'user' and m.created_at > now() - interval '24 hours'
  ) >= s.daily_questions_per_visitor then
    raise exception 'daily question limit reached' using errcode = '54000';
  end if;

  if v_conversation is null then
    insert into public.assistant_conversations (tenant_id, user_id, title, agent)
    values (v_tenant, auth.uid(), left(regexp_replace(v_question, '\s+', ' ', 'g'), 120), 'admissions')
    returning id into v_conversation;
    v_history := '[]'::jsonb;
  else
    if not exists (
      select 1 from public.assistant_conversations c
      where c.id = v_conversation and c.tenant_id = v_tenant and c.user_id = auth.uid() and c.agent = 'admissions'
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
  values (v_tenant, v_conversation, 'user', v_question, 'question');

  return jsonb_build_object(
    'conversation_id', v_conversation,
    'history', v_history,
    'instructions', s.assistant_instructions,
    'support_email', coalesce(s.contact_email, (select ts.support_email from public.tenant_settings ts where ts.tenant_id = v_tenant))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Student assistant functions: aware of the agent column
-- ---------------------------------------------------------------------------

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
    insert into public.assistant_conversations (tenant_id, user_id, title, agent)
    values (v_tenant, auth.uid(), left(regexp_replace(v_question, '\s+', ' ', 'g'), 120), 'student')
    returning id into v_conversation;
    v_history := '[]'::jsonb;
  else
    if not exists (
      select 1 from public.assistant_conversations c
      where c.id = v_conversation and c.tenant_id = v_tenant and c.user_id = auth.uid() and c.agent = 'student'
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

-- One completion function for both agents; usage is booked to the conversation's agent.
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
    values (c.tenant_id, auth.uid(), case when c.agent = 'admissions' then 'admissions_agent' else 'student_assistant' end, p_model,
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
  where msg.id = p_message and msg.role = 'assistant' and c.user_id = auth.uid()
    and (c.agent = 'admissions' or app.is_tenant_member(c.tenant_id));
  if m.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.assistant_feedback (message_id, tenant_id, user_id, rating, comment)
  values (m.id, m.tenant_id, auth.uid(), p_rating, nullif(btrim(p_comment), ''))
  on conflict (message_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now();
end;
$$;

-- Student assistant figures only (admissions has its own analytics).
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
      where u.tenant_id = v_tenant and u.feature = 'student_assistant' and u.created_at >= v_since
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
-- Staff: settings, leads pipeline, analytics
-- ---------------------------------------------------------------------------

create or replace function public.admissions_update_settings(
  p_tenant_slug text,
  p_public_enabled boolean,
  p_contact_email text,
  p_privacy_url text,
  p_welcome text,
  p_welcome_ar text,
  p_consent_text text,
  p_consent_text_ar text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_consent text := nullif(btrim(p_consent_text), '');
  v_consent_ar text := nullif(btrim(p_consent_text_ar), '');
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'programs.manage') or not app.tenant_has_feature(v_tenant, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.admissions_settings as cur (tenant_id, public_enabled, contact_email, privacy_url, welcome, welcome_ar,
                                          consent_text, consent_text_ar, consent_version, updated_by)
  values (v_tenant, coalesce(p_public_enabled, false), nullif(lower(btrim(p_contact_email)), ''), nullif(btrim(p_privacy_url), ''),
          nullif(btrim(p_welcome), ''), nullif(btrim(p_welcome_ar), ''), v_consent, v_consent_ar, 1, auth.uid())
  on conflict (tenant_id) do update
  set public_enabled = excluded.public_enabled, contact_email = excluded.contact_email, privacy_url = excluded.privacy_url,
      welcome = excluded.welcome, welcome_ar = excluded.welcome_ar,
      consent_text = excluded.consent_text, consent_text_ar = excluded.consent_text_ar,
      -- A new wording is a new consent version (each lead keeps the exact text it agreed to).
      consent_version = case
        when cur.consent_text is distinct from excluded.consent_text or cur.consent_text_ar is distinct from excluded.consent_text_ar
        then cur.consent_version + 1
        else cur.consent_version end,
      updated_by = excluded.updated_by;
end;
$$;

create or replace function public.admissions_update_assistant(
  p_tenant_slug text,
  p_enabled boolean,
  p_instructions text,
  p_monthly_budget_usd numeric,
  p_daily_questions integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'assistant.configure') or not app.tenant_has_feature(v_tenant, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.admissions_settings (tenant_id, assistant_enabled, assistant_instructions, monthly_budget_usd, daily_questions_per_visitor, updated_by)
  values (v_tenant, coalesce(p_enabled, false), nullif(btrim(p_instructions), ''), coalesce(p_monthly_budget_usd, 20), coalesce(p_daily_questions, 20), auth.uid())
  on conflict (tenant_id) do update
  set assistant_enabled = excluded.assistant_enabled, assistant_instructions = excluded.assistant_instructions,
      monthly_budget_usd = excluded.monthly_budget_usd, daily_questions_per_visitor = excluded.daily_questions_per_visitor,
      updated_by = excluded.updated_by;
end;
$$;

-- People a lead can be assigned to: active members who can read leads.
create or replace function public.admissions_assignees(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'leads.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', p.full_name, 'email', u.email) order by coalesce(p.full_name, u.email))
    from public.tenant_memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.tenant_id = v_tenant and m.status = 'active'
      and app.member_has_any_permission(v_tenant, m.user_id, array['leads.read', 'leads.manage'])
  ), '[]'::jsonb);
end;
$$;

-- Staff record an inquiry received in person, by phone or by email (consent described by staff).
create or replace function public.admissions_create_lead(
  p_tenant_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_country text,
  p_program uuid,
  p_intake text,
  p_message text,
  p_locale text,
  p_consent_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_lead uuid;
  v_reference text;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'leads.manage') or not app.tenant_has_feature(v_tenant, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_consent_note, ''))) < 10 then
    raise exception 'consent note required' using errcode = '22023';
  end if;
  if p_program is not null and not exists (select 1 from public.admission_programs p where p.id = p_program and p.tenant_id = v_tenant) then
    raise exception 'program not found' using errcode = '22023';
  end if;
  v_reference := app.next_lead_reference(v_tenant);
  insert into public.admission_leads (tenant_id, reference, full_name, email, phone, country, program_id, intake, message, locale,
                                      source, consent_at, consent_version, consent_text, submitted_by)
  values (v_tenant, v_reference, btrim(p_full_name), nullif(lower(btrim(p_email)), ''), nullif(btrim(p_phone), ''),
          nullif(btrim(p_country), ''), p_program, nullif(btrim(p_intake), ''), nullif(btrim(p_message), ''),
          coalesce(p_locale, 'en'), 'manual', now(), 'staff-recorded', btrim(p_consent_note), auth.uid())
  returning id into v_lead;
  insert into public.admission_lead_events (tenant_id, lead_id, actor_id, kind, to_value)
  values (v_tenant, v_lead, auth.uid(), 'created', 'manual');
  return jsonb_build_object('id', v_lead, 'reference', v_reference);
end;
$$;

-- Move a lead through the pipeline, (re)assign it or change its program. Every change is logged.
create or replace function public.admissions_update_lead(
  p_lead uuid,
  p_stage text,
  p_lost_reason text,
  p_assigned_to uuid,
  p_program uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.admission_leads;
begin
  select * into l from public.admission_leads where id = p_lead;
  if l.id is null or not app.has_permission(l.tenant_id, 'leads.manage') or not app.tenant_has_feature(l.tenant_id, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_assigned_to is not null and not app.member_has_any_permission(l.tenant_id, p_assigned_to, array['leads.read', 'leads.manage']) then
    raise exception 'assignee cannot read leads' using errcode = '22023';
  end if;
  if p_program is not null and not exists (select 1 from public.admission_programs p where p.id = p_program and p.tenant_id = l.tenant_id) then
    raise exception 'program not found' using errcode = '22023';
  end if;

  update public.admission_leads
  set stage = p_stage,
      lost_reason = case when p_stage = 'lost' then nullif(btrim(p_lost_reason), '') else null end,
      assigned_to = p_assigned_to,
      program_id = p_program
  where id = l.id;

  if l.stage is distinct from p_stage then
    insert into public.admission_lead_events (tenant_id, lead_id, actor_id, kind, from_value, to_value)
    values (l.tenant_id, l.id, auth.uid(), 'stage', l.stage, p_stage);
  end if;
  if l.assigned_to is distinct from p_assigned_to then
    insert into public.admission_lead_events (tenant_id, lead_id, actor_id, kind, from_value, to_value)
    values (l.tenant_id, l.id, auth.uid(), 'assigned', l.assigned_to::text, p_assigned_to::text);
  end if;
  if l.program_id is distinct from p_program then
    insert into public.admission_lead_events (tenant_id, lead_id, actor_id, kind, from_value, to_value)
    values (l.tenant_id, l.id, auth.uid(), 'program', l.program_id::text, p_program::text);
  end if;
end;
$$;

create or replace function public.admissions_add_note(p_lead uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.admission_leads;
  v_note uuid;
begin
  select * into l from public.admission_leads where id = p_lead;
  if l.id is null or not app.has_permission(l.tenant_id, 'leads.manage') or not app.tenant_has_feature(l.tenant_id, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.admission_lead_notes (tenant_id, lead_id, author_id, body)
  values (l.tenant_id, l.id, auth.uid(), btrim(p_body))
  returning id into v_note;
  insert into public.admission_lead_events (tenant_id, lead_id, actor_id, kind) values (l.tenant_id, l.id, auth.uid(), 'note');
  update public.admission_leads set updated_at = now() where id = l.id;
  return v_note;
end;
$$;

-- Erase a lead (e.g. a deletion request). Notes and history go with it; the audit log keeps
-- only the reference.
create or replace function public.admissions_delete_lead(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.admission_leads;
begin
  select * into l from public.admission_leads where id = p_lead;
  if l.id is null or not app.has_permission(l.tenant_id, 'leads.manage') or not app.tenant_has_feature(l.tenant_id, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.admission_leads where id = l.id;
  perform app.audit_fact(l.tenant_id, 'admission_leads.delete', 'admission_leads', l.id::text, jsonb_build_object('reference', l.reference));
end;
$$;

-- Admissions figures from stored records only.
create or replace function public.admissions_analytics(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_month timestamptz := date_trunc('month', now());
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'leads.read') or not app.tenant_has_feature(v_tenant, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (
    with leads as (select * from public.admission_leads where tenant_id = v_tenant),
    weeks as (
      select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as week_start
    ),
    turns as (
      select m.role, m.status, c.user_id from public.assistant_messages m
      join public.assistant_conversations c on c.id = m.conversation_id
      where c.tenant_id = v_tenant and c.agent = 'admissions' and m.created_at >= v_month
    )
    select jsonb_build_object(
      'total', (select count(*) from leads),
      'last_30_days', (select count(*) from leads where created_at >= now() - interval '30 days'),
      'open', (select count(*) from leads where stage in ('new', 'contacted', 'qualified', 'applied', 'admitted')),
      'unassigned_new', (select count(*) from leads where stage = 'new' and assigned_to is null),
      'by_stage', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (select stage, count(*) as n from leads group by stage) x),
      'by_source', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) as n from leads group by source) x),
      'by_program', (select coalesce(jsonb_agg(jsonb_build_object('program_id', x.program_id, 'name', x.name, 'name_ar', x.name_ar, 'count', x.n) order by x.n desc), '[]'::jsonb)
                     from (select l.program_id, p.name, p.name_ar, count(*) as n from leads l
                           left join public.admission_programs p on p.id = l.program_id
                           group by l.program_id, p.name, p.name_ar order by count(*) desc limit 10) x),
      'weekly', (select jsonb_agg(jsonb_build_object('week_start', w.week_start::date,
                   'count', (select count(*) from leads l where l.created_at >= w.week_start and l.created_at < w.week_start + interval '1 week'))
                   order by w.week_start) from weeks w),
      'assistant', jsonb_build_object(
        'questions', (select count(*) from turns where role = 'user'),
        'answered', (select count(*) from turns where status = 'answered'),
        'no_sources', (select count(*) from turns where status = 'no_sources'),
        'visitors', (select count(distinct user_id) from turns),
        'cost_usd', app.ai_month_cost(v_tenant, 'admissions_agent')
      )
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.public_admissions(text) from public;
grant execute on function public.public_admissions(text) to anon, authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admissions_submit_lead(text, text, text, text, text, uuid, text, text, text, text, text, uuid)',
    'public.admissions_search(text, text, integer)',
    'public.admissions_begin_turn(text, uuid, text)',
    'public.admissions_update_settings(text, boolean, text, text, text, text, text, text)',
    'public.admissions_update_assistant(text, boolean, text, numeric, integer)',
    'public.admissions_assignees(text)',
    'public.admissions_create_lead(text, text, text, text, text, uuid, text, text, text, text)',
    'public.admissions_update_lead(uuid, text, text, uuid, uuid)',
    'public.admissions_add_note(uuid, text)',
    'public.admissions_delete_lead(uuid)',
    'public.admissions_analytics(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
