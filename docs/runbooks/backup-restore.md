# Runbook: backup restore drill

> Status: written in Phase 16; **not yet performed** (it needs the production Supabase project on a
> plan with point-in-time recovery). Perform it before launch and then every quarter.

## Goal

Prove that a university's data can be brought back after a mistake or an incident, and measure how
long it takes (the recovery time) and how much is lost (the recovery point).

## Steps

1. **Pick a moment:** note the time T (UTC) and a few facts that should exist at T (for example the
   number of knowledge documents and tickets in the demo university).
2. **Restore to a new project, never over production:** in the Supabase dashboard, use point-in-time
   recovery (or the daily backup) to restore into a **new** project at time T.
3. **Check the restore:**
   - the migrations list matches production (`supabase migration list`);
   - the facts from step 1 match;
   - row counts of the main tables match what was noted (for example
     `select count(*) from public.tenants; select count(*) from public.knowledge_documents;`);
   - do **not** run `npm run test:db` against it (those tests create and drop databases).
4. **Storage:** check that a few files in `tenant-documents` and `tenant-assets` open. Storage
   objects are not part of the database backup: confirm the storage backup policy of the plan.
5. **Record:** the time taken, the data lost (difference between T and the newest restored row), and
   any step that did not work. Add the result to `docs/progress-log.md`.
6. **Clean up:** delete the restored project.

## Not covered

Restoring one university only (all universities share one database): that would be a targeted
export and re-import, written when it is first needed.
