-- UniAgent AI · Phase 6 · Migration 12: admissions maintenance.
--
-- * admissions_export_lead: everything stored about one inquiry, for a data-subject access
--   request, readable with leads.read. Each export leaves a PII-free audit entry (who exported
--   which reference).
-- * app.cleanup_anonymous_visitors: removes anonymous visitor accounts (ADR-025) older than N days
--   that have not been used since. Their assistant conversations go with them; inquiries stay,
--   with submitted_by and conversation_id set to null; AI usage records stay for cost accounting.
--   Not callable through the API: schedule it with pg_cron (supabase/README.md).

create or replace function public.admissions_export_lead(p_lead uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.admission_leads;
  v_result jsonb;
begin
  select * into l from public.admission_leads where id = p_lead;
  if l.id is null or not app.has_permission(l.tenant_id, 'leads.read') or not app.tenant_has_feature(l.tenant_id, 'admissions_agent') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'exported_at', now(),
    'university', (select t.name from public.tenants t where t.id = l.tenant_id),
    'inquiry', jsonb_build_object(
      'reference', l.reference,
      'full_name', l.full_name,
      'email', l.email,
      'phone', l.phone,
      'country', l.country,
      'program', (select jsonb_build_object('code', p.code, 'name', p.name, 'name_ar', p.name_ar)
                  from public.admission_programs p where p.id = l.program_id),
      'intake', l.intake,
      'message', l.message,
      'preferred_language', l.locale,
      'source', l.source,
      'stage', l.stage,
      'reason_closed', l.lost_reason,
      'received_at', l.created_at,
      'updated_at', l.updated_at
    ),
    'consent', jsonb_build_object('given_at', l.consent_at, 'version', l.consent_version, 'wording', l.consent_text),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('written_at', n.created_at, 'text', n.body) order by n.created_at)
      from public.admission_lead_notes n where n.lead_id = l.id
    ), '[]'::jsonb),
    -- History without internal identifiers (staff and program ids).
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', e.created_at,
        'event', e.kind,
        'from', case when e.kind = 'stage' then e.from_value end,
        'to', case when e.kind in ('stage', 'created') then e.to_value end
      ) order by e.created_at, e.id)
      from public.admission_lead_events e where e.lead_id = l.id
    ), '[]'::jsonb)
  ) into v_result;
  perform app.audit_fact(l.tenant_id, 'admission_leads.export', 'admission_leads', l.id::text, jsonb_build_object('reference', l.reference));
  return v_result;
end;
$$;

revoke all on function public.admissions_export_lead(uuid) from public, anon;
grant execute on function public.admissions_export_lead(uuid) to authenticated, service_role;

create or replace function app.cleanup_anonymous_visitors(p_older_than_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_older_than_days is null or p_older_than_days < 7 then
    raise exception 'keep anonymous visitors for at least 7 days' using errcode = '22023';
  end if;
  with gone as (
    delete from auth.users u
    where u.is_anonymous
      and u.created_at < now() - make_interval(days => p_older_than_days)
      and coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(days => p_older_than_days)
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

revoke all on function app.cleanup_anonymous_visitors(integer) from public, anon, authenticated;
