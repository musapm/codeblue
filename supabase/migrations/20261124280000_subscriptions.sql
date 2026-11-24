-- UniAgent AI · Phase 15 · Migration 21: plans, subscriptions, limits, manual payments and usage
-- reports.
--
-- * Plans are entered by platform staff (owner, admin, billing): features, limits, trial and
--   grace periods, and an optional price. No price is hard-coded; a plan without a price is
--   "by quote".
-- * Each university has at most one subscription. Assigning a plan sets the university's
--   features to the plan's features (platform staff can still switch single features after).
--   A university without a subscription keeps working without limits (as before this phase).
-- * Payments are recorded by hand (bank transfer, cash, ...). A payment can extend the paid
--   period: that is the renewal.
-- * subscription_sweep() moves subscriptions on when dates pass: trial over → expired; period
--   over → past due; past due beyond the grace period → suspended. Expired and suspended
--   universities are suspended (no data access, as in Phase 3). It is run by platform staff or a
--   scheduled job; nothing runs it automatically yet.
-- * Limits are enforced by the database: members (invitations and memberships), documents, and
--   a monthly AI spending cap across all AI features (checked in every AI gate).
-- * Usage reports: per university and month, counts and costs only (no personal data).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique constraint plans_key check (key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text not null constraint plans_name check (char_length(btrim(name)) between 2 and 80),
  name_ar text constraint plans_name_ar check (name_ar is null or char_length(btrim(name_ar)) between 2 and 80),
  description text constraint plans_description check (description is null or char_length(description) <= 1000),
  is_active boolean not null default true,
  -- Optional list price, entered by platform staff (null: by quote).
  currency text constraint plans_currency check (currency is null or currency ~ '^[A-Z]{3}$'),
  price_minor bigint constraint plans_price check (price_minor is null or price_minor >= 0),
  billing_interval text not null default 'year' constraint plans_interval check (billing_interval in ('month', 'year')),
  trial_days integer not null default 30 constraint plans_trial check (trial_days between 0 and 365),
  grace_days integer not null default 14 constraint plans_grace check (grace_days between 0 and 90),
  -- Limits; null means no limit.
  max_members integer constraint plans_max_members check (max_members is null or max_members between 1 and 1000000),
  max_documents integer constraint plans_max_documents check (max_documents is null or max_documents between 1 and 1000000),
  ai_monthly_usd numeric(10, 2) constraint plans_ai check (ai_monthly_usd is null or ai_monthly_usd >= 0),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_price_currency check ((currency is null) = (price_minor is null))
);

create table public.plan_features (
  plan_id uuid not null references public.plans (id) on delete cascade,
  feature_key text not null references public.features (key) on delete cascade,
  primary key (plan_id, feature_key)
);

create table public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status text not null constraint tenant_subscriptions_status check (status in ('trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled')),
  trial_ends_at timestamptz,
  period_end timestamptz,
  -- Per-university limits that replace the plan's (null: the plan's limit).
  max_members_override integer constraint tenant_subscriptions_members check (max_members_override is null or max_members_override between 1 and 1000000),
  max_documents_override integer constraint tenant_subscriptions_documents check (max_documents_override is null or max_documents_override between 1 and 1000000),
  ai_monthly_usd_override numeric(10, 2) constraint tenant_subscriptions_ai check (ai_monthly_usd_override is null or ai_monthly_usd_override >= 0),
  billing_notes text constraint tenant_subscriptions_notes check (billing_notes is null or char_length(billing_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenant_subscriptions_plan_idx on public.tenant_subscriptions (plan_id);

create table public.subscription_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null constraint subscription_events_kind check (kind in ('plan_assigned', 'status_changed', 'renewed', 'limits_changed', 'payment_recorded')),
  from_status text,
  to_status text,
  plan_key text,
  note text constraint subscription_events_note check (note is null or char_length(note) <= 500),
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index subscription_events_tenant_idx on public.subscription_events (tenant_id, created_at desc);

create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  amount_minor bigint not null constraint payment_records_amount check (amount_minor > 0),
  currency text not null constraint payment_records_currency check (currency ~ '^[A-Z]{3}$'),
  method text not null constraint payment_records_method check (method in ('bank_transfer', 'cash', 'cheque', 'card_offline', 'other')),
  reference text constraint payment_records_reference check (reference is null or char_length(btrim(reference)) between 1 and 120),
  paid_on date not null,
  extends_months smallint not null default 0 constraint payment_records_extends check (extends_months between 0 and 36),
  note text constraint payment_records_note check (note is null or char_length(note) <= 500),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payment_records_tenant_idx on public.payment_records (tenant_id, paid_on desc);

create trigger plans_updated_at before update on public.plans for each row execute function app.set_updated_at();
create trigger tenant_subscriptions_updated_at before update on public.tenant_subscriptions for each row execute function app.set_updated_at();
create trigger plans_audit after insert or update or delete on public.plans for each row execute function app.audit_row_change();
create trigger plan_features_audit after insert or update or delete on public.plan_features for each row execute function app.audit_row_change();
create trigger tenant_subscriptions_audit after insert or update or delete on public.tenant_subscriptions for each row execute function app.audit_row_change();
create trigger payment_records_audit after insert or update or delete on public.payment_records for each row execute function app.audit_row_change();

-- Platform billing staff read the tables; every write goes through the functions below.
alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.payment_records enable row level security;
revoke all on table public.plans, public.plan_features, public.tenant_subscriptions, public.subscription_events, public.payment_records from anon, authenticated;
grant select on table public.plans, public.plan_features, public.tenant_subscriptions, public.subscription_events, public.payment_records to authenticated;

create policy plans_select on public.plans for select to authenticated
  using (app.is_platform_admin(array['owner', 'admin', 'billing']::public.platform_role[]));
create policy plan_features_select on public.plan_features for select to authenticated
  using (app.is_platform_admin(array['owner', 'admin', 'billing']::public.platform_role[]));
create policy tenant_subscriptions_select on public.tenant_subscriptions for select to authenticated
  using (app.is_platform_admin(array['owner', 'admin', 'billing']::public.platform_role[]));
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (app.is_platform_admin(array['owner', 'admin', 'billing']::public.platform_role[]));
create policy payment_records_select on public.payment_records for select to authenticated
  using (app.is_platform_admin(array['owner', 'admin', 'billing']::public.platform_role[]));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function app.is_billing_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_platform_admin(array['owner', 'admin', 'billing']::public.platform_role[]);
$$;

-- Effective limits of a university (null values: no limit). Null when it has no subscription.
create or replace function app.plan_limits(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'members', coalesce(s.max_members_override, p.max_members),
    'documents', coalesce(s.max_documents_override, p.max_documents),
    'ai_monthly_usd', coalesce(s.ai_monthly_usd_override, p.ai_monthly_usd)
  )
  from public.tenant_subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.tenant_id = p_tenant;
$$;

-- The next status of a subscription at a moment (pure: used by the sweep and by tests).
create or replace function app.subscription_next_status(p_status text, p_trial_ends timestamptz, p_period_end timestamptz, p_grace integer, p_now timestamptz)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_status = 'trial' and p_trial_ends is not null and p_trial_ends <= p_now then 'expired'
    when p_status in ('active', 'past_due') and p_period_end is not null and p_period_end + make_interval(days => p_grace) <= p_now then 'suspended'
    when p_status = 'active' and p_period_end is not null and p_period_end <= p_now then 'past_due'
    when p_status = 'cancelled' and (p_period_end is null or p_period_end <= p_now) then 'expired'
    else p_status
  end;
$$;

-- What a subscription status means for the university's access.
create or replace function app.tenant_status_for(p_status text)
returns public.tenant_status
language sql immutable set search_path = ''
as $$
  select case p_status
    when 'trial' then 'trial'
    when 'suspended' then 'suspended'
    when 'expired' then 'suspended'
    else 'active'
  end::public.tenant_status;
$$;

-- Applies a status: subscription, university access (never un-archives), and an event.
create or replace function app.subscription_apply(p_tenant uuid, p_status text, p_kind text, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_from text;
begin
  select s.status into v_from from public.tenant_subscriptions s where s.tenant_id = p_tenant for update;
  update public.tenant_subscriptions set status = p_status where tenant_id = p_tenant;
  update public.tenants set status = app.tenant_status_for(p_status)
    where id = p_tenant and status <> 'archived' and status <> app.tenant_status_for(p_status);
  if v_from is distinct from p_status or p_kind <> 'status_changed' then
    insert into public.subscription_events (tenant_id, kind, from_status, to_status, note, actor_id)
    values (p_tenant, p_kind, v_from, p_status, left(p_note, 500), auth.uid());
  end if;
end;
$$;

create or replace function app.billing_tenant(p_slug text)
returns public.tenants
language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.tenants;
begin
  if not app.is_billing_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into t from public.tenants where slug = lower(btrim(p_slug));
  if t.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if t.status = 'archived' then
    raise exception 'archived' using errcode = '55000';
  end if;
  return t;
end;
$$;

revoke all on function app.is_billing_admin(), app.plan_limits(uuid), app.subscription_next_status(text, timestamptz, timestamptz, integer, timestamptz),
  app.tenant_status_for(text), app.subscription_apply(uuid, text, text, text), app.billing_tenant(text) from public;

-- ---------------------------------------------------------------------------
-- Limits, enforced by the database
-- ---------------------------------------------------------------------------

create or replace function app.enforce_member_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer := (app.plan_limits(new.tenant_id) ->> 'members')::integer;
  v_used integer;
begin
  if v_max is null then
    return new;
  end if;
  if tg_table_name = 'tenant_memberships' then
    if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
      return new;
    end if;
    select count(*) into v_used from public.tenant_memberships m where m.tenant_id = new.tenant_id and m.status = 'active' and m.id <> new.id;
  else
    -- invitations: members plus invitations still open
    select (select count(*) from public.tenant_memberships m where m.tenant_id = new.tenant_id and m.status = 'active')
         + (select count(*) from public.invitations i where i.tenant_id = new.tenant_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
      into v_used;
  end if;
  if v_used >= v_max then
    raise exception 'plan limit reached: members' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger tenant_memberships_plan_limit before insert or update of status on public.tenant_memberships
  for each row execute function app.enforce_member_limit();
create trigger invitations_plan_limit before insert on public.invitations
  for each row execute function app.enforce_member_limit();

create or replace function app.enforce_document_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer := (app.plan_limits(new.tenant_id) ->> 'documents')::integer;
begin
  if v_max is not null and (select count(*) from public.knowledge_documents d where d.tenant_id = new.tenant_id and d.archived_at is null) >= v_max then
    raise exception 'plan limit reached: documents' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger knowledge_documents_plan_limit before insert on public.knowledge_documents
  for each row execute function app.enforce_document_limit();

-- The plan's monthly AI cap across every AI feature (each AI gate calls this).
create or replace function app.plan_ai_check(p_tenant uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_max numeric := (app.plan_limits(p_tenant) ->> 'ai_monthly_usd')::numeric;
begin
  if v_max is not null and (
    select coalesce(sum(u.cost_usd), 0) from public.ai_usage_events u
    where u.tenant_id = p_tenant and u.created_at >= date_trunc('month', now())
  ) >= v_max then
    raise exception 'plan AI limit reached' using errcode = '53400';
  end if;
end;
$$;

revoke all on function app.enforce_member_limit(), app.enforce_document_limit(), app.plan_ai_check(uuid) from public;

-- ---------------------------------------------------------------------------
-- Plans (platform billing staff)
-- ---------------------------------------------------------------------------

create or replace function public.platform_plan_save(
  p_plan uuid, p_key text, p_name text, p_name_ar text, p_description text, p_is_active boolean,
  p_currency text, p_price_minor bigint, p_interval text, p_trial_days integer, p_grace_days integer,
  p_max_members integer, p_max_documents integer, p_ai_monthly_usd numeric, p_features text[], p_sort_order integer default 0
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_billing_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_features, '{}')) f where f not in (select key from public.features)) then
    raise exception 'unknown feature' using errcode = '22023';
  end if;
  if p_plan is null then
    insert into public.plans (key, name, name_ar, description, is_active, currency, price_minor, billing_interval, trial_days, grace_days, max_members, max_documents, ai_monthly_usd, sort_order)
    values (lower(btrim(p_key)), btrim(p_name), nullif(btrim(p_name_ar), ''), nullif(btrim(p_description), ''), coalesce(p_is_active, true), p_currency, p_price_minor,
            coalesce(p_interval, 'year'), coalesce(p_trial_days, 30), coalesce(p_grace_days, 14), p_max_members, p_max_documents, p_ai_monthly_usd, coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    -- The key is fixed once created (events and the app refer to it).
    update public.plans set name = btrim(p_name), name_ar = nullif(btrim(p_name_ar), ''), description = nullif(btrim(p_description), ''),
      is_active = coalesce(p_is_active, true), currency = p_currency, price_minor = p_price_minor, billing_interval = coalesce(p_interval, 'year'),
      trial_days = coalesce(p_trial_days, 30), grace_days = coalesce(p_grace_days, 14), max_members = p_max_members, max_documents = p_max_documents,
      ai_monthly_usd = p_ai_monthly_usd, sort_order = coalesce(p_sort_order, 0)
    where id = p_plan
    returning id into v_id;
    if v_id is null then
      raise exception 'not found' using errcode = 'P0002';
    end if;
  end if;
  delete from public.plan_features where plan_id = v_id and feature_key <> all (coalesce(p_features, '{}'));
  insert into public.plan_features (plan_id, feature_key) select v_id, f from unnest(coalesce(p_features, '{}')) f on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.platform_plans()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.is_billing_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'features', coalesce((select jsonb_agg(pf.feature_key order by pf.feature_key) from public.plan_features pf where pf.plan_id = p.id), '[]'::jsonb),
      'subscribers', (select count(*) from public.tenant_subscriptions s where s.plan_id = p.id)
    ) order by p.sort_order, p.name)
    from public.plans p
  ), '[]'::jsonb);
end;
$$;

-- A plan in use cannot be deleted (deactivate it instead).
create or replace function public.platform_plan_delete(p_plan uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_billing_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_subscriptions s where s.plan_id = p_plan) then
    raise exception 'plan in use' using errcode = '23503';
  end if;
  delete from public.plans where id = p_plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscriptions (platform billing staff)
-- ---------------------------------------------------------------------------

-- Assigns a plan, as a trial (the plan's trial days) or paid for p_months. The university's
-- features become the plan's features.
create or replace function public.platform_assign_plan(p_tenant_slug text, p_plan_key text, p_trial boolean, p_months integer, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tenants := app.billing_tenant(p_tenant_slug);
  p public.plans;
  v_status text := case when p_trial then 'trial' else 'active' end;
begin
  select * into p from public.plans where key = p_plan_key and is_active;
  if p.id is null then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  if not p_trial and (p_months is null or p_months not between 1 and 36) then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if p_trial and p.trial_days = 0 then
    raise exception 'plan has no trial' using errcode = '22023';
  end if;

  insert into public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at, period_end)
  values (t.id, p.id, v_status,
          case when p_trial then now() + make_interval(days => p.trial_days) end,
          case when not p_trial then now() + make_interval(months => p_months) end)
  on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = excluded.status,
    trial_ends_at = excluded.trial_ends_at, period_end = excluded.period_end;

  insert into public.tenant_features (tenant_id, feature_key, enabled)
  select t.id, f.key, exists (select 1 from public.plan_features pf where pf.plan_id = p.id and pf.feature_key = f.key)
  from public.features f
  on conflict (tenant_id, feature_key) do update set enabled = excluded.enabled;

  update public.tenants set status = app.tenant_status_for(v_status) where id = t.id and status <> app.tenant_status_for(v_status);
  insert into public.subscription_events (tenant_id, kind, to_status, plan_key, note, actor_id)
  values (t.id, 'plan_assigned', v_status, p.key, left(nullif(btrim(p_note), ''), 500), auth.uid());
end;
$$;

-- Manual decisions: suspend, reactivate, or cancel (access continues to the end of the period).
create or replace function public.platform_set_subscription_status(p_tenant_slug text, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tenants := app.billing_tenant(p_tenant_slug);
begin
  if p_status is null or p_status not in ('active', 'suspended', 'cancelled') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenant_subscriptions s where s.tenant_id = t.id) then
    raise exception 'no subscription' using errcode = 'P0002';
  end if;
  perform app.subscription_apply(t.id, p_status, 'status_changed', nullif(btrim(p_note), ''));
end;
$$;

create or replace function public.platform_set_limits(p_tenant_slug text, p_max_members integer, p_max_documents integer, p_ai_monthly_usd numeric, p_billing_notes text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tenants := app.billing_tenant(p_tenant_slug);
begin
  update public.tenant_subscriptions set max_members_override = p_max_members, max_documents_override = p_max_documents,
    ai_monthly_usd_override = p_ai_monthly_usd, billing_notes = nullif(btrim(p_billing_notes), '')
  where tenant_id = t.id;
  if not found then
    raise exception 'no subscription' using errcode = 'P0002';
  end if;
  insert into public.subscription_events (tenant_id, kind, actor_id) values (t.id, 'limits_changed', auth.uid());
end;
$$;

-- A payment received outside the product. With p_extends_months it renews the subscription:
-- the paid period runs from its current end (or now, if already over) and access is restored.
create or replace function public.platform_record_payment(
  p_tenant_slug text, p_amount_minor bigint, p_currency text, p_method text, p_reference text, p_paid_on date, p_extends_months integer, p_note text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tenants := app.billing_tenant(p_tenant_slug);
  s public.tenant_subscriptions;
  v_id uuid;
begin
  if p_paid_on is null or p_paid_on > current_date + 1 then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  select * into s from public.tenant_subscriptions where tenant_id = t.id for update;
  if coalesce(p_extends_months, 0) > 0 and s.tenant_id is null then
    raise exception 'no subscription' using errcode = 'P0002';
  end if;
  insert into public.payment_records (tenant_id, amount_minor, currency, method, reference, paid_on, extends_months, note, recorded_by)
  values (t.id, p_amount_minor, upper(btrim(p_currency)), p_method, nullif(btrim(p_reference), ''), p_paid_on, coalesce(p_extends_months, 0), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  insert into public.subscription_events (tenant_id, kind, note, actor_id)
  values (t.id, 'payment_recorded', p_amount_minor || ' ' || upper(btrim(p_currency)), auth.uid());

  if coalesce(p_extends_months, 0) > 0 then
    update public.tenant_subscriptions
      set period_end = greatest(coalesce(period_end, now()), now()) + make_interval(months => p_extends_months), trial_ends_at = null
      where tenant_id = t.id;
    perform app.subscription_apply(t.id, 'active', 'renewed', p_extends_months || ' months');
  end if;
  return v_id;
end;
$$;

-- Moves every subscription on to its status for now. For platform billing staff or a trusted
-- backend (a scheduled job with the service role).
create or replace function public.subscription_sweep()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_changed integer := 0;
begin
  if not (app.is_trusted_backend() or app.is_billing_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  for r in
    select s.tenant_id, s.status, app.subscription_next_status(s.status, s.trial_ends_at, s.period_end, p.grace_days, now()) as next
    from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id
  loop
    if r.next <> r.status then
      perform app.subscription_apply(r.tenant_id, r.next, 'status_changed', 'automatic');
      v_changed := v_changed + 1;
    end if;
  end loop;
  return jsonb_build_object('changed', v_changed);
end;
$$;

create or replace function public.platform_subscription(p_tenant_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.tenants;
begin
  if not app.is_billing_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into t from public.tenants where slug = lower(btrim(p_tenant_slug));
  if t.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status),
    'subscription', (select to_jsonb(s) || jsonb_build_object('plan_key', p.key, 'plan_name', p.name, 'grace_days', p.grace_days)
                     from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id where s.tenant_id = t.id),
    'limits', app.plan_limits(t.id),
    'usage', jsonb_build_object(
      'members', (select count(*) from public.tenant_memberships m where m.tenant_id = t.id and m.status = 'active'),
      'documents', (select count(*) from public.knowledge_documents d where d.tenant_id = t.id and d.archived_at is null),
      'ai_month_usd', (select coalesce(sum(u.cost_usd), 0) from public.ai_usage_events u where u.tenant_id = t.id and u.created_at >= date_trunc('month', now()))
    ),
    'payments', coalesce((select jsonb_agg(to_jsonb(pr) - 'recorded_by' order by pr.paid_on desc, pr.created_at desc) from public.payment_records pr where pr.tenant_id = t.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'actor_id' order by e.created_at desc) from (
      select * from public.subscription_events e where e.tenant_id = t.id order by e.created_at desc limit 50) e), '[]'::jsonb)
  );
end;
$$;

-- Usage per university for one month: counts and costs only.
create or replace function public.platform_usage_report(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_from timestamptz := date_trunc('month', coalesce(p_month, current_date)::timestamptz);
  v_to timestamptz := date_trunc('month', coalesce(p_month, current_date)::timestamptz) + interval '1 month';
begin
  if not app.is_billing_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('month', to_char(v_from, 'YYYY-MM'), 'tenants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'status', t.status, 'is_demo', t.is_demo,
      'plan', p.name, 'subscription_status', s.status, 'period_end', s.period_end, 'trial_ends_at', s.trial_ends_at,
      'limits', app.plan_limits(t.id),
      'members', (select count(*) from public.tenant_memberships m where m.tenant_id = t.id and m.status = 'active'),
      'documents', (select count(*) from public.knowledge_documents d where d.tenant_id = t.id and d.archived_at is null),
      'storage_bytes', (select coalesce(sum(v.size_bytes), 0) from public.knowledge_documents d join public.knowledge_document_versions v on v.id = d.current_version_id where d.tenant_id = t.id),
      'ai_calls', (select count(*) from public.ai_usage_events u where u.tenant_id = t.id and u.created_at >= v_from and u.created_at < v_to),
      'ai_cost_usd', (select coalesce(sum(u.cost_usd), 0) from public.ai_usage_events u where u.tenant_id = t.id and u.created_at >= v_from and u.created_at < v_to),
      'voice_cost_usd', (select coalesce(sum(vu.cost_usd), 0) from public.voice_usage_events vu where vu.tenant_id = t.id and vu.created_at >= v_from and vu.created_at < v_to),
      'conversations', (select count(*) from public.assistant_conversations c where c.tenant_id = t.id and c.created_at >= v_from and c.created_at < v_to),
      'tickets', (select count(*) from public.tickets k where k.tenant_id = t.id and k.created_at >= v_from and k.created_at < v_to),
      'paid', coalesce((select jsonb_object_agg(x.currency, x.total) from (
        select pr.currency, sum(pr.amount_minor) as total from public.payment_records pr
        where pr.tenant_id = t.id and pr.paid_on >= v_from::date and pr.paid_on < v_to::date group by pr.currency) x), '{}'::jsonb)
    ) order by t.name)
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id = t.id
    left join public.plans p on p.id = s.plan_id
    where t.status <> 'archived'
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The university's own view: plan, status, dates, limits and use. Readable by people with
-- tenant.settings.read even while suspended (so they can see why); payments only with
-- tenant.settings.manage.
-- ---------------------------------------------------------------------------

create or replace function app.has_role_permission(p_tenant uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and rp.permission_key = p_permission
  );
$$;
revoke all on function app.has_role_permission(uuid, text) from public;

create or replace function public.tenant_subscription(p_tenant_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = lower(btrim(p_tenant_slug));
  if t.id is null or not app.has_role_permission(t.id, 'tenant.settings.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'tenant_status', t.status,
    'subscription', (select jsonb_build_object('plan_name', p.name, 'plan_name_ar', p.name_ar, 'status', s.status, 'trial_ends_at', s.trial_ends_at,
                       'period_end', s.period_end, 'grace_days', p.grace_days, 'currency', p.currency, 'price_minor', p.price_minor, 'billing_interval', p.billing_interval)
                     from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id where s.tenant_id = t.id),
    'limits', app.plan_limits(t.id),
    'usage', jsonb_build_object(
      'members', (select count(*) from public.tenant_memberships m where m.tenant_id = t.id and m.status = 'active'),
      'documents', (select count(*) from public.knowledge_documents d where d.tenant_id = t.id and d.archived_at is null),
      'ai_month_usd', (select coalesce(sum(u.cost_usd), 0) from public.ai_usage_events u where u.tenant_id = t.id and u.created_at >= date_trunc('month', now()))
    ),
    'payments', case when app.has_role_permission(t.id, 'tenant.settings.manage') then coalesce((
      select jsonb_agg(jsonb_build_object('amount_minor', pr.amount_minor, 'currency', pr.currency, 'method', pr.method, 'reference', pr.reference, 'paid_on', pr.paid_on, 'extends_months', pr.extends_months)
        order by pr.paid_on desc)
      from public.payment_records pr where pr.tenant_id = t.id), '[]'::jsonb) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Every AI gate also checks the plan's monthly AI cap (53400, like the feature budgets).
-- ---------------------------------------------------------------------------

-- public.assistant_begin_turn: unchanged from 20261123151820_admissions.sql except the plan's AI cap.
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
  perform app.plan_ai_check(v_tenant);
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

-- public.admissions_begin_turn: unchanged from 20261123151820_admissions.sql except the plan's AI cap.
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
  perform app.plan_ai_check(v_tenant);
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

-- public.tickets_ai_begin: unchanged from 20261124120000_tickets.sql except the plan's AI cap.
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
  perform app.plan_ai_check(v_tenant);
  if s.tenant_id is null or app.assistant_month_cost(v_tenant) >= s.monthly_budget_usd then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if (select count(*) from public.ai_usage_events u
      where u.tenant_id = v_tenant and u.user_id = auth.uid() and u.feature = 'ticketing' and u.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily AI limit reached' using errcode = '54000';
  end if;
end;
$$;

-- public.academic_begin_generation: unchanged from 20261124160000_academic.sql except the plan's AI cap.
create or replace function public.academic_begin_generation(p_course uuid, p_kind text, p_documents uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.courses;
  s public.academic_settings;
  v_max constant integer := 120000;
begin
  select * into c from public.courses where id = p_course;
  if c.id is null or not app.can_view_course(c.id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if c.status = 'archived' or not c.ai_enabled then
    raise exception 'study tools are off for this course' using errcode = '55000';
  end if;
  if p_kind is null or p_kind not in ('summary', 'quiz', 'flashcards', 'study_plan') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if not (case p_kind when 'summary' then c.allow_summaries when 'quiz' then c.allow_quizzes when 'flashcards' then c.allow_flashcards else c.allow_study_plans end) then
    raise exception 'this study tool is off for this course' using errcode = '55000';
  end if;
  if p_documents is null or coalesce(cardinality(p_documents), 0) not between 1 and 10
     or cardinality(p_documents) <> (select count(distinct x) from unnest(p_documents) as x) then
    raise exception 'choose 1 to 10 materials' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_documents) as x (id)
    where not exists (
      select 1 from public.knowledge_documents d
      where d.id = x.id and d.course_id = c.id and d.current_version_id is not null and app.can_read_knowledge(d.tenant_id, d.id)
    )
  ) then
    raise exception 'material not available' using errcode = '22023';
  end if;
  select * into s from public.academic_settings where tenant_id = c.tenant_id;
  perform app.plan_ai_check(c.tenant_id);
  if coalesce(s.monthly_budget_usd, 0) <= app.ai_month_cost(c.tenant_id, 'academic_agent') then
    raise exception 'monthly AI budget reached' using errcode = '53400';
  end if;
  if (select count(*) from public.ai_usage_events u
      where u.tenant_id = c.tenant_id and u.user_id = auth.uid() and u.feature = 'academic_agent' and u.created_at > now() - interval '24 hours')
     >= coalesce(s.daily_limit, 20) then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;

  return (
    with docs as (
      select d.id, d.title, d.title_ar, d.current_version_id, v.version_no, x.ord
      from unnest(p_documents) with ordinality as x (id, ord)
      join public.knowledge_documents d on d.id = x.id
      join public.knowledge_document_versions v on v.id = d.current_version_id
    ),
    chunks as (
      select dk.id as document_id, ch.chunk_index, ch.page_from, ch.page_to, ch.heading, ch.content,
             sum(char_length(ch.content)) over (order by dk.ord, ch.chunk_index) as running
      from docs dk
      join public.knowledge_chunks ch on ch.version_id = dk.current_version_id
    )
    select jsonb_build_object(
      'course', jsonb_build_object('code', c.code, 'title', c.title, 'title_ar', c.title_ar, 'instructions', c.instructions),
      'truncated', exists (select 1 from chunks where running > v_max),
      'materials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'document_id', dk.id, 'version_no', dk.version_no, 'title', dk.title, 'title_ar', dk.title_ar,
          'chunks', coalesce((
            select jsonb_agg(jsonb_build_object('page_from', ch.page_from, 'page_to', ch.page_to, 'heading', ch.heading, 'content', ch.content)
                             order by ch.chunk_index)
            from chunks ch
            where ch.document_id = dk.id and ch.running <= v_max
          ), '[]'::jsonb)
        ) order by dk.ord)
        from docs dk
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- app.staff_gate: unchanged from 20261124180000_staff.sql except the plan's AI cap.
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
  perform app.plan_ai_check(p_tenant);
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

-- public.workflow_ai_begin: unchanged from 20261124200000_workflows.sql except the plan's AI cap.
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
  perform app.plan_ai_check(v_tenant);
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

-- public.campus_ai_begin: unchanged from 20261124220000_campus.sql except the plan's AI cap.
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
  perform app.plan_ai_check(v_tenant);
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.platform_plan_save(uuid, text, text, text, text, boolean, text, bigint, text, integer, integer, integer, integer, numeric, text[], integer)',
    'public.platform_plans()',
    'public.platform_plan_delete(uuid)',
    'public.platform_assign_plan(text, text, boolean, integer, text)',
    'public.platform_set_subscription_status(text, text, text)',
    'public.platform_set_limits(text, integer, integer, numeric, text)',
    'public.platform_record_payment(text, bigint, text, text, text, date, integer, text)',
    'public.subscription_sweep()',
    'public.platform_subscription(text)',
    'public.platform_usage_report(date)',
    'public.tenant_subscription(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
