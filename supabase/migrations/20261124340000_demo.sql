-- UniAgent AI · Phase 17 · Migration 24: demo content and a demo reset.
--
-- * app.demo_seed(tenant): fictional content for a demo university (is_demo = true only):
--   departments, request categories, published programs, campus locations with hours, a course
--   open to join, and a published service-request form. Idempotent: it only adds what is missing.
-- * public.platform_demo_reset(slug): platform owners and admins, demo universities only.
--   Deletes the activity created while demonstrating (chats, inquiries, requests, service
--   requests, study aids, drafts, notifications, usage) and adds back any missing demo content.
--   Members, roles, settings, the knowledge base and the audit log are kept. It refuses any
--   university that is not marked as a demo.

create or replace function app.demo_seed(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registrar uuid;
  v_admissions uuid;
  v_main uuid;
  v_def uuid;
  v_version uuid;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.is_demo) then
    raise exception 'not a demo university' using errcode = '42501';
  end if;

  insert into public.departments (tenant_id, slug, name, name_translations) values
    (p_tenant, 'admissions', 'Admissions', '{"ar": "القبول"}'),
    (p_tenant, 'registrar', 'Registrar', '{"ar": "عمادة التسجيل"}'),
    (p_tenant, 'student-affairs', 'Student Affairs', '{"ar": "شؤون الطلاب"}'),
    (p_tenant, 'finance', 'Finance', '{"ar": "الشؤون المالية"}'),
    (p_tenant, 'it-support', 'IT Support', '{"ar": "الدعم التقني"}'),
    (p_tenant, 'academic-affairs', 'Academic Affairs', '{"ar": "الشؤون الأكاديمية"}'),
    (p_tenant, 'library', 'Library', '{"ar": "المكتبة"}')
  on conflict (tenant_id, slug) do nothing;
  select id into v_registrar from public.departments where tenant_id = p_tenant and slug = 'registrar';
  select id into v_admissions from public.departments where tenant_id = p_tenant and slug = 'admissions';

  if not exists (select 1 from public.ticket_categories where tenant_id = p_tenant) then
    insert into public.ticket_categories (tenant_id, name, name_ar, department_id, default_priority, sort_order) values
      (p_tenant, 'Registration and records', 'التسجيل والسجلات', v_registrar, 'normal', 1),
      (p_tenant, 'Fees and payments', 'الرسوم والمدفوعات', (select id from public.departments where tenant_id = p_tenant and slug = 'finance'), 'normal', 2),
      (p_tenant, 'IT and accounts', 'التقنية والحسابات', (select id from public.departments where tenant_id = p_tenant and slug = 'it-support'), 'high', 3);
  end if;

  insert into public.admission_programs (tenant_id, code, name, name_ar, level, department_id, description, description_ar, requirements, requirements_ar,
      duration_months, study_mode, teaching_language, intakes, intakes_ar, status, sort_order, published_at)
  values
    (p_tenant, 'BSC-CS', 'BSc Computer Science', 'بكالوريوس علوم الحاسب', 'bachelor', v_admissions,
     'Programming, algorithms, data and software engineering, with a final-year project.', 'البرمجة والخوارزميات والبيانات وهندسة البرمجيات، مع مشروع تخرج.',
     'Secondary school certificate with mathematics; English placement test.', 'شهادة الثانوية العامة مع الرياضيات؛ اختبار تحديد مستوى في اللغة الإنجليزية.',
     48, 'full_time', 'en', 'September and February', 'سبتمبر وفبراير', 'published', 1, now()),
    (p_tenant, 'BSN', 'Bachelor of Nursing', 'بكالوريوس التمريض', 'bachelor', v_admissions,
     'Clinical nursing with hospital placements from the second year.', 'التمريض السريري مع تدريب في المستشفيات من السنة الثانية.',
     'Secondary school certificate (science track); interview.', 'شهادة الثانوية العامة (المسار العلمي)؛ مقابلة شخصية.',
     48, 'full_time', 'mixed', 'September', 'سبتمبر', 'published', 2, now()),
    (p_tenant, 'MBA', 'Master of Business Administration', 'ماجستير إدارة الأعمال', 'master', v_admissions,
     'Evening programme for working professionals.', 'برنامج مسائي للموظفين.',
     'Bachelor degree and two years of work experience.', 'درجة البكالوريوس وخبرة عمل لا تقل عن سنتين.',
     24, 'part_time', 'en', 'October', 'أكتوبر', 'published', 3, now())
  on conflict (tenant_id, code) do nothing;

  if not exists (select 1 from public.campus_locations where tenant_id = p_tenant) then
    insert into public.campus_locations (tenant_id, kind, name, name_ar, code, description, latitude, longitude, accessibility, published, aliases)
    values (p_tenant, 'building', 'Main Building', 'المبنى الرئيسي', 'A', 'Administration and student services.', 24.713600, 46.675300,
            '{"step_free_entrance": true, "elevator": true, "accessible_toilet": true}', true, '{"Building A"}')
    returning id into v_main;
    insert into public.campus_locations (tenant_id, kind, name, name_ar, code, parent_id, floor, department_id, latitude, longitude, opening_hours, hours_note, accessibility, phone, published, aliases)
    values
      (p_tenant, 'office', 'Registrar''s Office', 'مكتب عمادة التسجيل', 'A-104', v_main, '1', v_registrar, 24.713700, 46.675400,
       '{"sun": [["08:00", "15:00"]], "mon": [["08:00", "15:00"]], "tue": [["08:00", "15:00"]], "wed": [["08:00", "15:00"]], "thu": [["08:00", "13:00"]]}',
       'Closed on public holidays.', '{"step_free_entrance": true, "elevator": true}', '+000 0000 0104', true, '{"registration office","records"}'),
      (p_tenant, 'library', 'Central Library', 'المكتبة المركزية', 'L', null, null, (select id from public.departments where tenant_id = p_tenant and slug = 'library'), 24.714100, 46.676000,
       '{"sun": [["08:00", "22:00"]], "mon": [["08:00", "22:00"]], "tue": [["08:00", "22:00"]], "wed": [["08:00", "22:00"]], "thu": [["08:00", "18:00"]], "sat": [["10:00", "18:00"]]}',
       null, '{"step_free_entrance": true, "elevator": true, "accessible_toilet": true, "hearing_loop": false}', null, true, '{"library"}'),
      (p_tenant, 'cafeteria', 'Student Cafeteria', 'مقهى الطلاب', 'C', null, null, null, 24.713200, 46.676200,
       '{"sun": [["07:30", "17:00"]], "mon": [["07:30", "17:00"]], "tue": [["07:30", "17:00"]], "wed": [["07:30", "17:00"]], "thu": [["07:30", "14:00"]]}',
       null, '{"step_free_entrance": true}', null, true, '{}'),
      (p_tenant, 'clinic', 'Health Clinic', 'العيادة الصحية', 'A-010', v_main, 'G', null, 24.713500, 46.675200,
       '{"sun": [["08:00", "16:00"]], "mon": [["08:00", "16:00"]], "tue": [["08:00", "16:00"]], "wed": [["08:00", "16:00"]], "thu": [["08:00", "16:00"]]}',
       'Emergencies: call campus security.', '{"step_free_entrance": true, "accessible_toilet": true}', null, true, '{"medical"}');
  end if;

  if not exists (select 1 from public.courses where tenant_id = p_tenant and code = 'CS101') then
    insert into public.courses (tenant_id, code, title, title_ar, description, department_id, term, status, ai_enabled, join_code)
    values (p_tenant, 'CS101', 'Introduction to Programming', 'مقدمة في البرمجة', 'Variables, control flow, functions and simple data structures.',
            (select id from public.departments where tenant_id = p_tenant and slug = 'academic-affairs'), 'Fall 2026', 'active', true, 'NBDEMOCS');
  end if;

  if not exists (select 1 from public.workflow_definitions where tenant_id = p_tenant and key = 'transcript-request') then
    insert into public.workflow_definitions (tenant_id, key, title, title_ar, description, description_ar, department_id, status)
    values (p_tenant, 'transcript-request', 'Official transcript', 'كشف درجات رسمي', 'Request a stamped copy of your academic transcript.', 'اطلب نسخة مختومة من كشف درجاتك.', v_registrar, 'active')
    returning id into v_def;
    insert into public.workflow_versions (tenant_id, definition_id, version_no, fields, instructions, instructions_ar, confirmation, confirmation_ar, status, published_at)
    values (p_tenant, v_def, 1,
      '[{"key": "copies", "type": "number", "label": "Number of copies", "label_ar": "عدد النسخ", "required": true},
        {"key": "delivery", "type": "select", "label": "Delivery", "label_ar": "طريقة الاستلام", "required": true,
         "options": [{"value": "pickup", "label": "Pick up at the Registrar", "label_ar": "الاستلام من عمادة التسجيل"}, {"value": "email", "label": "By email (PDF)", "label_ar": "بالبريد الإلكتروني (PDF)"}]},
        {"key": "notes", "type": "textarea", "label": "Notes", "label_ar": "ملاحظات", "required": false}]',
      'Transcripts are ready within three working days.', 'تجهز الكشوف خلال ثلاثة أيام عمل.',
      'We will tell you here when your transcript is ready.', 'سنبلغك هنا عندما يجهز الكشف.', 'published', now())
    returning id into v_version;
    update public.workflow_definitions set current_version_id = v_version where id = v_def;
  end if;
end;
$$;
revoke all on function app.demo_seed(uuid) from public;

create or replace function public.platform_demo_reset(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_deleted bigint := 0;
  v_n bigint;
  v_table text;
begin
  if not app.is_platform_admin(array['owner', 'admin']::public.platform_role[]) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into t from public.tenants where slug = lower(btrim(p_slug));
  if t.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not t.is_demo then
    raise exception 'only demo universities can be reset' using errcode = '42501';
  end if;

  -- Activity, children before parents (foreign keys also cascade).
  foreach v_table in array array[
    'notifications', 'outbound_messages', 'ai_quality_reviews', 'assistant_feedback', 'assistant_messages', 'assistant_conversations',
    'ai_usage_events', 'voice_usage_events', 'admission_lead_events', 'admission_lead_notes', 'admission_leads',
    'ticket_events', 'ticket_internal_notes', 'ticket_messages', 'tickets', 'academic_quiz_attempts', 'academic_items',
    'staff_drafts', 'workflow_request_events', 'workflow_requests', 'integration_logs'
  ]
  loop
    execute format('delete from public.%I where tenant_id = $1', v_table) using t.id;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  perform app.demo_seed(t.id);
  insert into public.audit_logs (tenant_id, actor_id, actor_type, action, target_type, target_id, metadata)
  values (t.id, auth.uid(), 'platform_admin', 'demo.reset', 'tenants', t.id::text, jsonb_build_object('deleted_rows', v_deleted));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;
revoke all on function public.platform_demo_reset(text) from public, anon;
grant execute on function public.platform_demo_reset(text) to authenticated, service_role;
