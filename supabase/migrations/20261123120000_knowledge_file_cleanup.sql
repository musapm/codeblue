-- UniAgent AI · Phase 4 · Migration 9: let file cleanup see orphaned originals.
--
-- knowledge_delete_document removes the database rows first (one transaction) and the app then
-- removes the files. Supabase Storage only deletes objects the caller can also SELECT, and the
-- select policy required a readable document, which no longer exists at that point, so files
-- were silently left behind (found by the live test). Knowledge managers of the tenant may now
-- also see files whose document row is gone, so they can be removed. Nothing else changes.

drop policy tenant_documents_select on storage.objects;

create policy tenant_documents_select on storage.objects for select to authenticated
  using (
    bucket_id = 'tenant-documents'
    and (
      app.can_read_knowledge(app.try_uuid((storage.foldername(name))[1]), app.try_uuid((storage.foldername(name))[2]))
      or (
        app.has_permission(app.try_uuid((storage.foldername(name))[1]), 'knowledge.manage')
        and not exists (select 1 from public.knowledge_documents d where d.id = app.try_uuid((storage.foldername(name))[2]))
      )
    )
  );
