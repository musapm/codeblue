-- UniAgent AI · Phase 4 · Migration 8: knowledge base.
--
-- Documents with versions, extracted chunks (full-text search for Arabic and English, and an
-- optional embedding per chunk), per-document visibility, and a private storage bucket for the
-- original files. All writes go through SECURITY DEFINER functions that check permissions; reads
-- are filtered by RLS (app.can_read_knowledge). Retrieval (search_knowledge) applies the same
-- rules BEFORE ranking, so a caller can only ever rank chunks they are allowed to read.

create extension if not exists vector with schema extensions;

create type public.knowledge_visibility as enum ('public', 'members', 'staff', 'restricted');
create type public.knowledge_version_status as enum ('uploading', 'queued', 'processing', 'ready', 'failed', 'needs_ocr');

-- ---------------------------------------------------------------------------
-- Search text helpers (IMMUTABLE: used by a generated column)
-- ---------------------------------------------------------------------------

-- Unicode NFKC, lower case, Arabic normalization: diacritics (U+064B–U+065F, U+0670) and tatweel
-- (U+0640) removed, alef/yaa/taa-marbuta variants unified, Arabic-Indic digits mapped to ASCII.
-- Character classes are built with chr() so this file stays free of escape sequences.
create or replace function app.normalize_search_text(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(
    regexp_replace(lower(normalize(coalesce(p, ''), NFKC)), '[' || chr(1611) || '-' || chr(1631) || chr(1648) || chr(1600) || ']', '', 'g'),
    'أإآٱىة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    'اااايه01234567890123456789'
  );
$$;

-- Arabic-script runs are indexed with the Arabic stemmer, everything else with English.
create or replace function app.knowledge_tsvector(p text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_tsvector('pg_catalog.english'::regconfig, regexp_replace(n, '[' || chr(1536) || '-' || chr(1791) || ']+', ' ', 'g'))
      || to_tsvector('pg_catalog.arabic'::regconfig, regexp_replace(n, '[^' || chr(1536) || '-' || chr(1791) || ']+', ' ', 'g'))
  from (select app.normalize_search_text(p) as n) s;
$$;

-- Natural-language question → OR query over its stemmed terms (ranking decides relevance).
create or replace function app.knowledge_tsquery(p text)
returns tsquery
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when count(*) = 0 then null
    else to_tsquery('pg_catalog.simple'::regconfig, string_agg(quote_literal(l), ' | ')) end
  from (
    select distinct regexp_replace(t, '[^[:alnum:]_' || chr(1536) || '-' || chr(1791) || ']', '', 'g') as l
    from unnest(tsvector_to_array(app.knowledge_tsvector(left(coalesce(p, ''), 500)))) as t
  ) x
  where l <> '';
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null constraint knowledge_documents_title check (char_length(btrim(title)) between 2 and 200),
  title_ar text constraint knowledge_documents_title_ar check (title_ar is null or char_length(btrim(title_ar)) between 2 and 200),
  description text constraint knowledge_documents_description check (description is null or char_length(description) <= 1000),
  language text not null default 'en' constraint knowledge_documents_language check (language in ('en', 'ar', 'mixed')),
  department_id uuid,
  category text constraint knowledge_documents_category check (category is null or char_length(btrim(category)) between 1 and 60),
  visibility public.knowledge_visibility not null default 'staff',
  is_authoritative boolean not null default false,
  source_priority smallint not null default 50 constraint knowledge_documents_priority check (source_priority between 0 and 100),
  effective_date date,
  expiry_date date,
  source_url text constraint knowledge_documents_source_url check (source_url is null or (source_url ~ '^https://[^\s]+$' and char_length(source_url) <= 2000)),
  current_version_id uuid,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_dates check (expiry_date is null or effective_date is null or expiry_date >= effective_date),
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id) on delete set null (department_id)
);
create index knowledge_documents_tenant_idx on public.knowledge_documents (tenant_id, updated_at desc);

create table public.knowledge_document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null,
  version_no integer not null constraint knowledge_versions_no check (version_no >= 1),
  storage_path text not null unique
    constraint knowledge_versions_path check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/v[0-9]{1,4}/[A-Za-z0-9._-]{1,120}$'),
  file_name text not null constraint knowledge_versions_file_name check (char_length(file_name) between 1 and 255),
  mime_type text not null constraint knowledge_versions_mime check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv'
  )),
  size_bytes bigint not null constraint knowledge_versions_size check (size_bytes between 1 and 26214400),
  sha256 text constraint knowledge_versions_sha256 check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status public.knowledge_version_status not null default 'uploading',
  error_code text constraint knowledge_versions_error check (error_code is null or error_code ~ '^[a-z_]{3,40}$'),
  page_count integer,
  char_count integer,
  chunk_count integer,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  activated_at timestamptz,
  unique (document_id, version_no),
  unique (tenant_id, id),
  foreign key (tenant_id, document_id) references public.knowledge_documents (tenant_id, id) on delete cascade
);

alter table public.knowledge_documents
  add constraint knowledge_documents_current_version_fk foreign key (tenant_id, current_version_id)
  references public.knowledge_document_versions (tenant_id, id) on delete set null (current_version_id);

create table public.knowledge_chunks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  chunk_index integer not null constraint knowledge_chunks_index check (chunk_index >= 0),
  page_from integer constraint knowledge_chunks_page_from check (page_from is null or page_from >= 1),
  page_to integer constraint knowledge_chunks_page_to check (page_to is null or page_to >= page_from),
  heading text constraint knowledge_chunks_heading check (heading is null or char_length(heading) <= 300),
  content text not null constraint knowledge_chunks_content check (char_length(content) between 1 and 8000),
  search_tsv tsvector generated always as (app.knowledge_tsvector(coalesce(heading, '') || ' ' || content)) stored,
  embedding extensions.vector,
  embedding_model text constraint knowledge_chunks_model check (embedding_model is null or embedding_model ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'),
  created_at timestamptz not null default now(),
  constraint knowledge_chunks_embedding_pair check ((embedding is null) = (embedding_model is null)),
  unique (version_id, chunk_index),
  foreign key (tenant_id, document_id) references public.knowledge_documents (tenant_id, id) on delete cascade,
  foreign key (tenant_id, version_id) references public.knowledge_document_versions (tenant_id, id) on delete cascade
);
create index knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (search_tsv);
create index knowledge_chunks_document_idx on public.knowledge_chunks (tenant_id, document_id);

-- Who may read a `restricted` document (departments and/or roles of the same tenant).
create table public.knowledge_document_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null,
  department_id uuid,
  role_id uuid,
  constraint knowledge_access_target check (num_nonnulls(department_id, role_id) = 1),
  unique nulls not distinct (document_id, department_id, role_id),
  foreign key (tenant_id, document_id) references public.knowledge_documents (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade
);
create index knowledge_access_document_idx on public.knowledge_document_access (document_id);

create trigger knowledge_documents_updated_at before update on public.knowledge_documents
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

-- Can the caller read this document (and its chunks and original file)?
--   * the uploader, publishers (knowledge.publish) and, for non-restricted documents,
--     knowledge managers: always (drafts included);
--   * everyone else: only published, current, not archived, not expired documents, by visibility:
--     public/members → knowledge.read_public or read_internal; staff → read_internal;
--     restricted → read_internal AND (one of the listed departments or roles).
-- Requires an active membership in an operating tenant with the knowledge_base feature enabled.
-- Support-access sessions do not read knowledge content (ADR-019).
create or replace function app.can_read_knowledge(p_tenant uuid, p_document uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.knowledge_documents d
    where d.id = p_document
      and d.tenant_id = p_tenant
      and app.is_tenant_member(p_tenant)
      and app.tenant_has_feature(p_tenant, 'knowledge_base')
      and (
        d.created_by = auth.uid()
        or app.has_permission(p_tenant, 'knowledge.publish')
        or (d.visibility <> 'restricted' and app.has_permission(p_tenant, 'knowledge.manage'))
        or (
          d.published_at is not null
          and d.current_version_id is not null
          and d.archived_at is null
          and (d.expiry_date is null or d.expiry_date >= current_date)
          and case d.visibility
            when 'public' then app.has_permission(p_tenant, 'knowledge.read_public') or app.has_permission(p_tenant, 'knowledge.read_internal')
            when 'members' then app.has_permission(p_tenant, 'knowledge.read_public') or app.has_permission(p_tenant, 'knowledge.read_internal')
            when 'staff' then app.has_permission(p_tenant, 'knowledge.read_internal')
            when 'restricted' then app.has_permission(p_tenant, 'knowledge.read_internal') and exists (
              select 1
              from public.knowledge_document_access a
              where a.document_id = d.id
                and (
                  (a.department_id is not null and app.in_department(p_tenant, a.department_id))
                  or (a.role_id is not null and exists (
                    select 1
                    from public.tenant_memberships m
                    join public.membership_roles mr on mr.membership_id = m.id
                    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and mr.role_id = a.role_id
                  ))
                )
            )
          end
        )
      )
  );
$$;

-- Can the caller change this document? knowledge.manage (or publish) AND able to read it.
create or replace function app.can_manage_knowledge(p_tenant uuid, p_document uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (app.has_permission(p_tenant, 'knowledge.manage') or app.has_permission(p_tenant, 'knowledge.publish'))
    and app.tenant_has_feature(p_tenant, 'knowledge_base')
    and app.can_read_knowledge(p_tenant, p_document);
$$;

revoke all on function app.normalize_search_text(text), app.knowledge_tsvector(text), app.knowledge_tsquery(text),
  app.can_read_knowledge(uuid, uuid), app.can_manage_knowledge(uuid, uuid) from public;
grant execute on function app.normalize_search_text(text), app.knowledge_tsvector(text), app.knowledge_tsquery(text),
  app.can_read_knowledge(uuid, uuid), app.can_manage_knowledge(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: reads only. Every write goes through the functions below.
-- ---------------------------------------------------------------------------

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_document_versions enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_document_access enable row level security;

revoke all on table public.knowledge_documents, public.knowledge_document_versions, public.knowledge_chunks,
  public.knowledge_document_access from anon, authenticated;
grant select on table public.knowledge_documents, public.knowledge_document_versions, public.knowledge_chunks,
  public.knowledge_document_access to authenticated;

create policy knowledge_documents_select on public.knowledge_documents for select to authenticated
  using (app.can_read_knowledge(tenant_id, id));
create policy knowledge_versions_select on public.knowledge_document_versions for select to authenticated
  using (app.can_read_knowledge(tenant_id, document_id));
create policy knowledge_chunks_select on public.knowledge_chunks for select to authenticated
  using (app.can_read_knowledge(tenant_id, document_id));
create policy knowledge_access_select on public.knowledge_document_access for select to authenticated
  using (app.can_manage_knowledge(tenant_id, document_id));

-- Audit (chunks are derived data and not audited row by row).
create trigger knowledge_documents_audit after insert or update or delete on public.knowledge_documents
  for each row execute function app.audit_row_change();
create trigger knowledge_document_versions_audit after insert or update or delete on public.knowledge_document_versions
  for each row execute function app.audit_row_change();
create trigger knowledge_document_access_audit after insert or update or delete on public.knowledge_document_access
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Write API
-- ---------------------------------------------------------------------------

-- Apply metadata (and the restricted-access list) to a document. Table constraints and the
-- composite foreign keys validate values and keep departments/roles inside the tenant.
create or replace function app.knowledge_apply_meta(p_document uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.knowledge_documents;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    raise exception 'invalid metadata' using errcode = '22023';
  end if;
  select * into v_doc from public.knowledge_documents where id = p_document;

  update public.knowledge_documents set
    title = coalesce(nullif(btrim(p_meta ->> 'title'), ''), v_doc.title),
    title_ar = case when p_meta ? 'title_ar' then nullif(btrim(p_meta ->> 'title_ar'), '') else v_doc.title_ar end,
    description = case when p_meta ? 'description' then nullif(btrim(p_meta ->> 'description'), '') else v_doc.description end,
    language = coalesce(p_meta ->> 'language', v_doc.language),
    department_id = case when p_meta ? 'department_id' then nullif(p_meta ->> 'department_id', '')::uuid else v_doc.department_id end,
    category = case when p_meta ? 'category' then nullif(btrim(p_meta ->> 'category'), '') else v_doc.category end,
    visibility = coalesce((p_meta ->> 'visibility')::public.knowledge_visibility, v_doc.visibility),
    is_authoritative = coalesce((p_meta ->> 'is_authoritative')::boolean, v_doc.is_authoritative),
    source_priority = coalesce((p_meta ->> 'source_priority')::smallint, v_doc.source_priority),
    effective_date = case when p_meta ? 'effective_date' then nullif(p_meta ->> 'effective_date', '')::date else v_doc.effective_date end,
    expiry_date = case when p_meta ? 'expiry_date' then nullif(p_meta ->> 'expiry_date', '')::date else v_doc.expiry_date end,
    source_url = case when p_meta ? 'source_url' then nullif(btrim(p_meta ->> 'source_url'), '') else v_doc.source_url end
  where id = p_document;

  if p_meta ? 'access_department_ids' or p_meta ? 'access_role_ids' then
    delete from public.knowledge_document_access where document_id = p_document;
    insert into public.knowledge_document_access (tenant_id, document_id, department_id)
    select v_doc.tenant_id, p_document, x::uuid
    from jsonb_array_elements_text(coalesce(p_meta -> 'access_department_ids', '[]'::jsonb)) as x;
    insert into public.knowledge_document_access (tenant_id, document_id, role_id)
    select v_doc.tenant_id, p_document, x::uuid
    from jsonb_array_elements_text(coalesce(p_meta -> 'access_role_ids', '[]'::jsonb)) as x;
  end if;

  -- A restricted document without anyone on its list would be readable only by managers.
  if (select visibility from public.knowledge_documents where id = p_document) = 'restricted'
     and not exists (select 1 from public.knowledge_document_access where document_id = p_document) then
    raise exception 'restricted documents need at least one department or role' using errcode = '23514';
  end if;
end;
$$;
revoke all on function app.knowledge_apply_meta(uuid, jsonb) from public;

-- Start an upload: creates the document (when p_document is null) and a new version in
-- status 'uploading', and returns the storage path the client may upload to (storage policy
-- tenant_documents_insert only accepts registered, still-uploading paths).
create or replace function public.knowledge_begin_upload(
  p_tenant_slug text,
  p_document uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_slug(p_tenant_slug);
  v_document uuid := p_document;
  v_version uuid;
  v_no integer;
  v_path text;
  v_ext text;
begin
  if v_tenant is null or not app.has_permission(v_tenant, 'knowledge.manage') or not app.tenant_has_feature(v_tenant, 'knowledge_base') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_document is null then
    if nullif(btrim(p_meta ->> 'title'), '') is null then
      raise exception 'title required' using errcode = '22023';
    end if;
    insert into public.knowledge_documents (tenant_id, title, created_by)
    values (v_tenant, btrim(p_meta ->> 'title'), auth.uid())
    returning id into v_document;
    perform app.knowledge_apply_meta(v_document, p_meta);
  else
    if not exists (select 1 from public.knowledge_documents d where d.id = v_document and d.tenant_id = v_tenant)
       or not app.can_manage_knowledge(v_tenant, v_document) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.knowledge_document_versions v
      where v.document_id = v_document and v.status in ('uploading', 'queued', 'processing')
        and v.created_at > now() - interval '1 hour'
    ) then
      raise exception 'another version is still being processed' using errcode = '55P03';
    end if;
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_no from public.knowledge_document_versions v where v.document_id = v_document;
  v_ext := case p_mime_type
    when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'text/plain' then 'txt'
    when 'text/csv' then 'csv'
    else 'bin'
  end;
  v_path := v_tenant::text || '/' || v_document::text || '/v' || v_no || '/source.' || v_ext;

  insert into public.knowledge_document_versions (tenant_id, document_id, version_no, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_tenant, v_document, v_no, v_path, left(btrim(p_file_name), 255), p_mime_type, p_size_bytes, auth.uid())
  returning id into v_version;

  return jsonb_build_object('document_id', v_document, 'version_id', v_version, 'version_no', v_no, 'storage_path', v_path);
end;
$$;

-- Transitions of a version, all for callers who can manage the document:
--   uploading → queued (file verified), queued/failed/needs_ocr → processing, → failed/needs_ocr.
create or replace function public.knowledge_set_version_status(
  p_version uuid,
  p_status public.knowledge_version_status,
  p_error_code text default null,
  p_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_document_versions;
begin
  select * into v from public.knowledge_document_versions where id = p_version for update;
  if v.id is null or not app.can_manage_knowledge(v.tenant_id, v.document_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (
    (v.status = 'uploading' and p_status in ('queued', 'failed'))
    or (v.status in ('queued', 'failed', 'needs_ocr', 'processing') and p_status = 'processing')
    or (v.status = 'processing' and p_status in ('failed', 'needs_ocr'))
  ) then
    raise exception 'invalid status transition' using errcode = '22023';
  end if;
  update public.knowledge_document_versions set
    status = p_status,
    error_code = case when p_status in ('failed', 'needs_ocr') then coalesce(p_error_code, 'extraction_failed') else null end,
    sha256 = coalesce(p_sha256, sha256),
    processed_at = case when p_status in ('failed', 'needs_ocr') then now() else processed_at end
  where id = p_version;
  return jsonb_build_object('storage_path', v.storage_path, 'mime_type', v.mime_type, 'tenant_id', v.tenant_id, 'document_id', v.document_id);
end;
$$;

-- Store the extracted chunks of a version and make it the document's current version, in one
-- transaction: chunks of every other version of the document are removed, so retrieval never
-- mixes versions.
create or replace function public.knowledge_complete_version(p_version uuid, p_stats jsonb, p_chunks jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_document_versions;
  v_count integer;
begin
  select * into v from public.knowledge_document_versions where id = p_version for update;
  if v.id is null or not app.can_manage_knowledge(v.tenant_id, v.document_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v.status <> 'processing' then
    raise exception 'version is not being processed' using errcode = '22023';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 or jsonb_array_length(p_chunks) > 5000 then
    raise exception 'invalid chunks' using errcode = '22023';
  end if;

  delete from public.knowledge_chunks where document_id = v.document_id;
  insert into public.knowledge_chunks (tenant_id, document_id, version_id, chunk_index, page_from, page_to, heading, content)
  select v.tenant_id, v.document_id, v.id, (c.ordinality - 1)::integer,
         nullif(c.value ->> 'page_from', '')::integer, nullif(c.value ->> 'page_to', '')::integer,
         nullif(c.value ->> 'heading', ''), c.value ->> 'content'
  from jsonb_array_elements(p_chunks) with ordinality as c;
  get diagnostics v_count = row_count;

  update public.knowledge_document_versions set
    status = 'ready', error_code = null, processed_at = now(), activated_at = now(),
    page_count = nullif(p_stats ->> 'page_count', '')::integer,
    char_count = nullif(p_stats ->> 'char_count', '')::integer,
    chunk_count = v_count
  where id = p_version;
  update public.knowledge_documents set current_version_id = p_version where id = v.document_id;
end;
$$;

-- Attach embeddings (from the configured EmbeddingProvider) to chunks of the current version.
create or replace function public.knowledge_set_embeddings(p_version uuid, p_model text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.knowledge_document_versions;
  v_count integer;
begin
  select * into v from public.knowledge_document_versions where id = p_version;
  if v.id is null or not app.can_manage_knowledge(v.tenant_id, v.document_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid embeddings' using errcode = '22023';
  end if;
  update public.knowledge_chunks c
  set embedding = (i.value ->> 'embedding')::extensions.vector, embedding_model = p_model
  from jsonb_array_elements(p_items) as i
  where c.version_id = p_version and c.chunk_index = (i.value ->> 'chunk_index')::integer;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.knowledge_update_document(p_document uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select d.tenant_id from public.knowledge_documents d where d.id = p_document);
begin
  if v_tenant is null or not app.can_manage_knowledge(v_tenant, p_document) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform app.knowledge_apply_meta(p_document, p_meta);
end;
$$;

-- Publishing is a separate permission (review before students see a document).
create or replace function public.knowledge_set_published(p_document uuid, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.knowledge_documents;
begin
  select * into d from public.knowledge_documents where id = p_document;
  if d.id is null or not app.has_permission(d.tenant_id, 'knowledge.publish') or not app.tenant_has_feature(d.tenant_id, 'knowledge_base') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_published and d.current_version_id is null then
    raise exception 'document has no processed version' using errcode = '22023';
  end if;
  update public.knowledge_documents
  set published_at = case when p_published then now() end, published_by = case when p_published then auth.uid() end
  where id = p_document;
end;
$$;

create or replace function public.knowledge_set_archived(p_document uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select d.tenant_id from public.knowledge_documents d where d.id = p_document);
begin
  if v_tenant is null or not app.can_manage_knowledge(v_tenant, p_document) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.knowledge_documents set archived_at = case when p_archived then now() end where id = p_document;
end;
$$;

-- Deletes a document with all versions and chunks (one transaction). Returns the storage
-- paths of its files; the caller removes them from the bucket (delete policy below).
create or replace function public.knowledge_delete_document(p_document uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select d.tenant_id from public.knowledge_documents d where d.id = p_document);
  v_paths text[];
begin
  if v_tenant is null or not app.can_manage_knowledge(v_tenant, p_document) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(array_agg(v.storage_path), '{}') into v_paths from public.knowledge_document_versions v where v.document_id = p_document;
  delete from public.knowledge_documents where id = p_document;
  return v_paths;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retrieval
-- ---------------------------------------------------------------------------

-- Hybrid search over the chunks the CALLER may read: published, current, not archived, not
-- expired, visible to them (app.can_read_knowledge is applied to documents before ranking).
-- Full-text rank and, when a query embedding of the same model is given, vector similarity
-- are fused with Reciprocal Rank Fusion; authoritative and high-priority sources are boosted.
-- Drafts are never returned, not even to managers: this is what an assistant would see.
create or replace function public.search_knowledge(
  p_tenant_slug text,
  p_query text,
  p_limit integer default 8,
  p_embedding extensions.vector default null,
  p_embedding_model text default null
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.knowledge_begin_upload(text, uuid, text, text, bigint, jsonb)',
    'public.knowledge_set_version_status(uuid, public.knowledge_version_status, text, text)',
    'public.knowledge_complete_version(uuid, jsonb, jsonb)',
    'public.knowledge_set_embeddings(uuid, text, jsonb)',
    'public.knowledge_update_document(uuid, jsonb)',
    'public.knowledge_set_published(uuid, boolean)',
    'public.knowledge_set_archived(uuid, boolean)',
    'public.knowledge_delete_document(uuid)',
    'public.search_knowledge(text, text, integer, extensions.vector, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for original files, "<tenant>/<document>/v<n>/source.<ext>".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-documents', 'tenant-documents', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv'
])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Uploads only to a registered version path that is still waiting for its file.
create policy tenant_documents_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tenant-documents'
    and exists (
      select 1 from public.knowledge_document_versions v
      where v.storage_path = name and v.status = 'uploading'
        and v.tenant_id = app.try_uuid((storage.foldername(name))[1])
        and app.can_manage_knowledge(v.tenant_id, v.document_id)
    )
  );
-- Originals can be read by anyone who can read the document (signed URLs are created per user).
create policy tenant_documents_select on storage.objects for select to authenticated
  using (
    bucket_id = 'tenant-documents'
    and app.can_read_knowledge(app.try_uuid((storage.foldername(name))[1]), app.try_uuid((storage.foldername(name))[2]))
  );
-- Removal: managers of the document, or files whose document row was already deleted by
-- knowledge_delete_document (the caller must still manage knowledge in that tenant).
create policy tenant_documents_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'tenant-documents'
    and app.has_permission(app.try_uuid((storage.foldername(name))[1]), 'knowledge.manage')
    and (
      app.can_manage_knowledge(app.try_uuid((storage.foldername(name))[1]), app.try_uuid((storage.foldername(name))[2]))
      or not exists (select 1 from public.knowledge_documents d where d.id = app.try_uuid((storage.foldername(name))[2]))
    )
  );
