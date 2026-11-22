-- Demo tenant: "Northbridge University" (FICTIONAL — no real institution, no real people).
-- Idempotent: safe to run more than once. Run as a trusted session (SQL editor / psql).
-- Marked is_demo = true so it can be reset or excluded from reporting.

do $$
declare
  v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'northbridge';
  if v_tenant is null then
    v_tenant := public.create_tenant('northbridge', 'Northbridge University', null, 'en', 'UTC', true);
  end if;

  update public.tenants
  set name_translations = '{"en": "Northbridge University", "ar": "جامعة نورثبريدج"}'::jsonb
  where id = v_tenant;

  update public.tenant_branding
  set published = '{
        "primary": "#1b4f8f",
        "secondary": "#0f2a4a",
        "accent": "#b7862c",
        "assistant_name": "Northbridge Assistant",
        "assistant_name_ar": "مساعد نورثبريدج",
        "welcome": "Hi! Ask me about registration, fees, exams, or campus services.",
        "welcome_ar": "مرحباً! اسألني عن التسجيل أو الرسوم أو الامتحانات أو خدمات الحرم الجامعي.",
        "monogram": "NU"
      }'::jsonb,
      published_at = now()
  where tenant_id = v_tenant;

  insert into public.departments (tenant_id, slug, name, name_translations) values
    (v_tenant, 'admissions', 'Admissions', '{"ar": "القبول"}'),
    (v_tenant, 'registrar', 'Registrar', '{"ar": "عمادة التسجيل"}'),
    (v_tenant, 'student-affairs', 'Student Affairs', '{"ar": "شؤون الطلاب"}'),
    (v_tenant, 'finance', 'Finance', '{"ar": "الشؤون المالية"}'),
    (v_tenant, 'it-support', 'IT Support', '{"ar": "الدعم التقني"}'),
    (v_tenant, 'academic-affairs', 'Academic Affairs', '{"ar": "الشؤون الأكاديمية"}'),
    (v_tenant, 'library', 'Library', '{"ar": "المكتبة"}')
  on conflict (tenant_id, slug) do nothing;
end
$$;
