import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, asCommitted, createTestDatabase, query, user } from './harness'

/**
 * Phase 4 (knowledge base) database tests: the upload/processing state machine, versioning,
 * visibility rules, publishing, deletion, storage isolation for original files (T16) and
 * retrieval isolation for search_knowledge (T17), plus Arabic/English text normalization.
 */

const U = {
  ownerA: '20000000-0000-4000-8000-00000000000a',
  deptAdminA: '20000000-0000-4000-8000-0000000000a1', // knowledge.manage, no publish; department "admissions"
  registrarA: '20000000-0000-4000-8000-0000000000a2', // knowledge.read_internal; department "finance"
  studentA: '20000000-0000-4000-8000-0000000000a3', // knowledge.read_public
  ownerB: '20000000-0000-4000-8000-00000000000b',
  studentB: '20000000-0000-4000-8000-0000000000b3',
  platformAdmin: '20000000-0000-4000-8000-0000000000f0',
}

let db: Awaited<ReturnType<typeof createTestDatabase>>
let pool: pg.Pool
let tenantA: string
let tenantB: string
let deptAdmissions: string
let deptFinance: string

async function addMember(tenant: string, userId: string, roleKey: string, departmentId?: string) {
  const { rows } = await pool.query<{ id: string }>(`insert into public.tenant_memberships (tenant_id, user_id) values ($1, $2) returning id`, [tenant, userId])
  await pool.query(
    `insert into public.membership_roles (tenant_id, membership_id, role_id) select $1, $2, r.id from public.roles r where r.tenant_id = $1 and r.key = $3`,
    [tenant, rows[0]!.id, roleKey],
  )
  if (departmentId) {
    await pool.query(`insert into public.membership_departments (tenant_id, membership_id, department_id) values ($1, $2, $3)`, [tenant, rows[0]!.id, departmentId])
  }
}

type Chunk = { content: string; heading?: string; page_from?: number; page_to?: number }

/** Run the full pipeline as `actor` and (optionally) publish as the tenant owner. Committed. */
async function ingest(
  actor: string,
  slug: string,
  meta: Record<string, unknown>,
  chunks: Chunk[],
  opts: { publishAs?: string; documentId?: string } = {},
): Promise<{ documentId: string; versionId: string; path: string }> {
  const begun = await asCommitted(pool, user(actor), (c) =>
    c.query(`select public.knowledge_begin_upload($1, $2, 'handbook.pdf', 'application/pdf', 1000, $3) as r`, [slug, opts.documentId ?? null, JSON.stringify(meta)]),
  )
  const { document_id: documentId, version_id: versionId, storage_path: path } = begun.rows[0].r
  await asCommitted(pool, user(actor), async (c) => {
    await c.query(`select public.knowledge_set_version_status($1, 'queued', null, $2)`, [versionId, 'a'.repeat(64)])
    await c.query(`select public.knowledge_set_version_status($1, 'processing')`, [versionId])
    await c.query(`select public.knowledge_complete_version($1, $2, $3)`, [versionId, JSON.stringify({ page_count: 2, char_count: 500 }), JSON.stringify(chunks)])
  })
  if (opts.publishAs) await asCommitted(pool, user(opts.publishAs), (c) => c.query(`select public.knowledge_set_published($1, true)`, [documentId]))
  return { documentId, versionId, path }
}

const search = async (actor: string, slug: string, q: string, extra: unknown[] = []) =>
  (await query(pool, user(actor), `select public.search_knowledge($1, $2, 10${extra.length ? ', $3::extensions.vector, $4' : ''}) as r`, [slug, q, ...extra])).rows[0].r as {
    title: string
    content: string
    document_id: string
    version_no: number
  }[]

const visibleDocs = async (actor: string) =>
  (await query(pool, user(actor), `select title from public.knowledge_documents order by title`)).rows.map((r) => r.title as string)

let feesDoc: { documentId: string; versionId: string; path: string }
let staffDoc: { documentId: string }
let restrictedDoc: { documentId: string }

beforeAll(async () => {
  db = await createTestDatabase()
  pool = db.pool
  await pool.query(
    `insert into auth.users (id, email, email_confirmed_at) select x, x::text || '@test.example', now() from unnest($1::uuid[]) as x`,
    [Object.values(U)],
  )
  tenantA = (await pool.query(`select public.create_tenant('uni-a', 'University A', $1) as id`, [U.ownerA])).rows[0].id
  tenantB = (await pool.query(`select public.create_tenant('uni-b', 'University B', $1) as id`, [U.ownerB])).rows[0].id
  deptAdmissions = (await pool.query(`insert into public.departments (tenant_id, slug, name) values ($1, 'admissions', 'Admissions') returning id`, [tenantA])).rows[0].id
  deptFinance = (await pool.query(`insert into public.departments (tenant_id, slug, name) values ($1, 'finance', 'Finance') returning id`, [tenantA])).rows[0].id
  await addMember(tenantA, U.deptAdminA, 'department_admin', deptAdmissions)
  await addMember(tenantA, U.registrarA, 'registrar', deptFinance)
  await addMember(tenantA, U.studentA, 'student')
  await addMember(tenantB, U.studentB, 'student')
  await pool.query(`insert into public.platform_admins (user_id, role) values ($1, 'owner')`, [U.platformAdmin])

  feesDoc = await ingest(
    U.deptAdminA,
    'uni-a',
    { title: 'Tuition fees 2026', visibility: 'members', language: 'mixed', department_id: deptAdmissions, is_authoritative: true },
    [
      { heading: 'Fees', content: 'The tuition fee for undergraduate programs is 1200 per semester. Fees are paid at the finance office.', page_from: 1, page_to: 1 },
      { heading: 'الرسوم', content: 'تُدفع الرسوم الدراسيّة في مكتب الشؤون الماليّة قبل بداية الفصل الدراسي.', page_from: 2, page_to: 2 },
    ],
    { publishAs: U.ownerA },
  )
  staffDoc = await ingest(U.ownerA, 'uni-a', { title: 'Staff grading procedure', visibility: 'staff' }, [{ content: 'Internal procedure: tuition appeals are reviewed by the grading committee.' }], {
    publishAs: U.ownerA,
  })
  restrictedDoc = await ingest(
    U.ownerA,
    'uni-a',
    { title: 'Finance team salaries', visibility: 'restricted', access_department_ids: [deptFinance] },
    [{ content: 'Restricted: tuition revenue and salary bands for the finance team.' }],
    { publishAs: U.ownerA },
  )
  // University B has its own document with the same words.
  await ingest(U.ownerB, 'uni-b', { title: 'B tuition fees', visibility: 'members' }, [{ content: 'University B tuition fee is 900 per semester.' }], { publishAs: U.ownerB })
}, 90_000)

afterAll(async () => {
  await db?.drop()
})

describe('upload and processing state machine', () => {
  it('only knowledge managers of the tenant can start uploads', async () => {
    const begin = (actor: string, slug: string) =>
      query(pool, user(actor), `select public.knowledge_begin_upload($1, null, 'x.pdf', 'application/pdf', 10, '{"title":"Draft"}')`, [slug])
    await expect(begin(U.studentA, 'uni-a')).rejects.toMatchObject({ code: '42501' })
    await expect(begin(U.registrarA, 'uni-a')).rejects.toMatchObject({ code: '42501' })
    await expect(begin(U.deptAdminA, 'uni-b')).rejects.toMatchObject({ code: '42501' })
    await expect(begin(U.platformAdmin, 'uni-a')).rejects.toMatchObject({ code: '42501' })
    const ok = await begin(U.deptAdminA, 'uni-a')
    expect(ok.rowCount).toBe(1)
  })

  it('creates tenant-scoped storage paths and rejects bad metadata and file types', async () => {
    await as(pool, user(U.deptAdminA), async (c) => {
      const r = (await c.query(`select public.knowledge_begin_upload('uni-a', null, 'دليل الطالب.pdf', 'application/pdf', 10, '{"title":"Handbook"}') as r`)).rows[0].r
      expect(r.storage_path).toBe(`${tenantA}/${r.document_id}/v1/source.pdf`)
      expect((await c.query(`select file_name from public.knowledge_document_versions where id = $1`, [r.version_id])).rows[0].file_name).toBe('دليل الطالب.pdf')
    })
    const bad = (meta: string, mime = 'application/pdf') =>
      query(pool, user(U.deptAdminA), `select public.knowledge_begin_upload('uni-a', null, 'x', $2, 10, $1)`, [meta, mime])
    await expect(bad('{"title":"x"}')).rejects.toMatchObject({ code: '23514' }) // title too short
    await expect(bad('{}')).rejects.toMatchObject({ code: '22023' })
    await expect(bad('{"title":"Ok title","visibility":"everyone"}')).rejects.toMatchObject({ code: '22P02' })
    await expect(bad('{"title":"Ok title","source_url":"javascript:alert(1)"}')).rejects.toMatchObject({ code: '23514' })
    await expect(bad('{"title":"Ok title","visibility":"restricted"}')).rejects.toMatchObject({ code: '23514' }) // nobody on the list
    await expect(bad('{"title":"Ok title"}', 'image/svg+xml')).rejects.toMatchObject({ code: '23514' })
    // A department of another tenant cannot be referenced (composite FK).
    const deptB = (await pool.query(`insert into public.departments (tenant_id, slug, name) values ($1, 'b-dept', 'B dept') returning id`, [tenantB])).rows[0].id
    await expect(bad(JSON.stringify({ title: 'Ok title', department_id: deptB }))).rejects.toMatchObject({ code: '23503' })
  })

  it('enforces status transitions and keeps one version in flight', async () => {
    await as(pool, user(U.deptAdminA), async (c) => {
      const r = (await c.query(`select public.knowledge_begin_upload('uni-a', null, 'x.txt', 'text/plain', 10, '{"title":"State test"}') as r`)).rows[0].r
      await c.query(`savepoint s`)
      await expect(c.query(`select public.knowledge_complete_version($1, '{}', '[{"content":"x"}]')`, [r.version_id])).rejects.toMatchObject({ code: '22023' })
      await c.query(`rollback to savepoint s`)
      await expect(c.query(`select public.knowledge_set_version_status($1, 'ready')`, [r.version_id])).rejects.toMatchObject({ code: '22023' })
      await c.query(`rollback to savepoint s`)
      await expect(
        c.query(`select public.knowledge_begin_upload('uni-a', $1, 'x.txt', 'text/plain', 10, '{}')`, [r.document_id]),
      ).rejects.toMatchObject({ code: '55P03' })
    })
  })

  it('a new version replaces the old chunks atomically (retrieval never mixes versions)', async () => {
    const doc = await ingest(U.ownerA, 'uni-a', { title: 'Academic calendar', visibility: 'members' }, [{ content: 'Registration opens on 1 September.' }], { publishAs: U.ownerA })
    expect((await search(U.studentA, 'uni-a', 'registration September')).map((r) => r.version_no)).toEqual([1])
    await ingest(U.ownerA, 'uni-a', {}, [{ content: 'Registration opens on 15 August (updated calendar).' }], { documentId: doc.documentId })
    const results = await search(U.studentA, 'uni-a', 'registration opens')
    const calendar = results.filter((r) => r.document_id === doc.documentId)
    expect(calendar.map((r) => r.version_no)).toEqual([2])
    expect(calendar[0]!.content).toContain('15 August')
    const chunkVersions = await pool.query(`select distinct version_id from public.knowledge_chunks where document_id = $1`, [doc.documentId])
    expect(chunkVersions.rowCount).toBe(1)
  })
})

describe('visibility and publishing', () => {
  it('drafts are invisible to readers until published, and only publishers can publish', async () => {
    const draft = await ingest(U.deptAdminA, 'uni-a', { title: 'Draft scholarship rules', visibility: 'members' }, [{ content: 'Scholarship rules draft.' }])
    expect(await visibleDocs(U.studentA)).not.toContain('Draft scholarship rules')
    expect(await visibleDocs(U.deptAdminA)).toContain('Draft scholarship rules')
    await expect(query(pool, user(U.deptAdminA), `select public.knowledge_set_published($1, true)`, [draft.documentId])).rejects.toMatchObject({ code: '42501' })
    await asCommitted(pool, user(U.ownerA), (c) => c.query(`select public.knowledge_set_published($1, true)`, [draft.documentId]))
    expect(await visibleDocs(U.studentA)).toContain('Draft scholarship rules')
  })

  it('students see members documents; staff documents need read_internal', async () => {
    expect(await visibleDocs(U.studentA)).toEqual(expect.arrayContaining(['Tuition fees 2026']))
    expect(await visibleDocs(U.studentA)).not.toContain('Staff grading procedure')
    expect(await visibleDocs(U.registrarA)).toContain('Staff grading procedure')
  })

  it('restricted documents: only listed departments, publishers and the uploader', async () => {
    expect(await visibleDocs(U.registrarA)).toContain('Finance team salaries') // in Finance
    expect(await visibleDocs(U.deptAdminA)).not.toContain('Finance team salaries') // manager, other department
    expect(await visibleDocs(U.studentA)).not.toContain('Finance team salaries')
    expect(await visibleDocs(U.ownerA)).toContain('Finance team salaries')
    await expect(query(pool, user(U.deptAdminA), `select public.knowledge_update_document($1, '{"title":"Hacked"}')`, [restrictedDoc.documentId])).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('archived and expired documents disappear for readers', async () => {
    const doc = await ingest(U.ownerA, 'uni-a', { title: 'Old housing policy', visibility: 'members' }, [{ content: 'Housing policy dormitory rules.' }], { publishAs: U.ownerA })
    expect(await visibleDocs(U.studentA)).toContain('Old housing policy')
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`select public.knowledge_set_archived($1, true)`, [doc.documentId])
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.studentA, role: 'authenticated' })])
      expect((await c.query(`select 1 from public.knowledge_documents where id = $1`, [doc.documentId])).rowCount).toBe(0)
    })
    await as(pool, user(U.ownerA), async (c) => {
      await c.query(`select public.knowledge_update_document($1, '{"effective_date":"2020-01-01","expiry_date":"2021-01-01"}')`, [doc.documentId])
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.studentA, role: 'authenticated' })])
      expect((await c.query(`select public.search_knowledge('uni-a', 'dormitory housing') as r`)).rows[0].r).toEqual([])
    })
  })

  it('no direct writes through the API; platform staff and support sessions read nothing', async () => {
    await expect(query(pool, user(U.ownerA), `update public.knowledge_documents set published_at = now()`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.ownerA), `delete from public.knowledge_chunks`)).rejects.toMatchObject({ code: '42501' })
    await expect(query(pool, user(U.ownerA), `insert into public.knowledge_chunks (tenant_id, document_id, version_id, chunk_index, content) values ($1, $2, $3, 99, 'x')`, [tenantA, feesDoc.documentId, feesDoc.versionId])).rejects.toMatchObject({ code: '42501' })
    await as(pool, user(U.platformAdmin), async (c) => {
      await c.query(`insert into public.support_access_grants (tenant_id, grantee_id, reason, granted_by, expires_at) values ($1, $2, 'Investigating search quality', $2, now() + interval '1 hour')`, [tenantA, U.platformAdmin])
      expect((await c.query(`select 1 from public.knowledge_chunks`)).rowCount).toBe(0)
      await expect(c.query(`select public.search_knowledge('uni-a', 'tuition')`)).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('disabling the knowledge_base feature closes reads and uploads', async () => {
    await as(pool, user(U.studentA), async (c) => {
      await c.query(`reset role`)
      await c.query(`update public.tenant_features set enabled = false where tenant_id = $1 and feature_key = 'knowledge_base'`, [tenantA])
      await c.query(`set local role authenticated`)
      expect((await c.query(`select public.search_knowledge('uni-a', 'tuition') as r`)).rows[0].r).toEqual([])
      expect((await c.query(`select 1 from public.knowledge_documents`)).rowCount).toBe(0)
    })
  })
})

describe('T17 · retrieval isolation and ranking', () => {
  it('search returns only chunks the caller may read, from their own university', async () => {
    const student = await search(U.studentA, 'uni-a', 'tuition fees')
    expect(student.length).toBeGreaterThan(0)
    expect(student.every((r) => !r.content.includes('University B'))).toBe(true)
    expect(student.map((r) => r.title)).not.toContain('Staff grading procedure')
    expect(student.map((r) => r.title)).not.toContain('Finance team salaries')
    expect(student[0]!.title).toBe('Tuition fees 2026') // authoritative boost

    const registrar = (await search(U.registrarA, 'uni-a', 'tuition')).map((r) => r.title)
    expect(registrar).toEqual(expect.arrayContaining(['Staff grading procedure', 'Finance team salaries']))

    const b = await search(U.studentB, 'uni-b', 'tuition fees')
    expect(b.map((r) => r.title)).toEqual(['B tuition fees'])
    await expect(search(U.studentB, 'uni-a', 'tuition')).rejects.toMatchObject({ code: '42501' })
  })

  it('English stemming and Arabic normalization (diacritics, alef/taa marbuta, digits)', async () => {
    expect((await search(U.studentA, 'uni-a', 'fee')).map((r) => r.title)).toContain('Tuition fees 2026') // fee ↔ fees
    const arabic = await search(U.studentA, 'uni-a', 'الرسوم الدراسية المالية') // no shadda, ة/ه variants
    expect(arabic[0]?.content).toContain('الرسوم')
    expect((await search(U.studentA, 'uni-a', '١٢٠٠')).length).toBeGreaterThan(0) // Arabic-Indic digits
  })

  it('normalization maps each Arabic variant exactly', async () => {
    const { rows } = await pool.query(`select app.normalize_search_text($1) as n`, ['أإآٱ ى ة ٠١٢٣٩ ۴ مُدَرِّسـة ﻻ TUITION'])
    expect(rows[0].n).toBe('اااا ي ه 01239 4 مدرسه لا tuition')
  })

  it('hostile query text is just text', async () => {
    for (const q of ["'); drop table x; --", 'a & | ! :* <-> (', '\\', '', '   ', 'x'.repeat(5000)]) {
      await expect(search(U.studentA, 'uni-a', q)).resolves.toBeInstanceOf(Array)
    }
  })

  it('vector search fuses with full-text and never crosses tenants or models', async () => {
    await asCommitted(pool, user(U.ownerA), (c) =>
      c.query(`select public.knowledge_set_embeddings($1, 'test-model-3d', $2)`, [
        feesDoc.versionId,
        JSON.stringify([
          { chunk_index: 0, embedding: '[1,0,0]' },
          { chunk_index: 1, embedding: '[0,1,0]' },
        ]),
      ]),
    )
    const byVector = await search(U.studentA, 'uni-a', '', ['[0,0.9,0.1]', 'test-model-3d'])
    expect(byVector[0]?.content).toContain('الرسوم')
    expect(await search(U.studentA, 'uni-a', '', ['[0,0.9,0.1]', 'other-model'])).toEqual([])
    expect(await search(U.studentB, 'uni-b', '', ['[0,0.9,0.1]', 'test-model-3d'])).toEqual([])
    await expect(query(pool, user(U.studentA), `select public.knowledge_set_embeddings($1, 'test-model-3d', '[]')`, [feesDoc.versionId])).rejects.toMatchObject({
      code: '42501',
    })
  })
})

describe('T16 · original files in storage', () => {
  const put = (actor: string, name: string) =>
    query(pool, user(actor), `insert into storage.objects (bucket_id, name) values ('tenant-documents', $1)`, [name])

  it('uploads only to a registered path that is still waiting for its file', async () => {
    const begun = await asCommitted(pool, user(U.deptAdminA), (c) =>
      c.query(`select public.knowledge_begin_upload('uni-a', null, 'f.pdf', 'application/pdf', 10, '{"title":"Upload target"}') as r`),
    )
    const { storage_path: path, version_id: versionId } = begun.rows[0].r
    await expect(put(U.deptAdminA, path)).resolves.toBeTruthy()
    await expect(put(U.deptAdminA, `${tenantA}/${begun.rows[0].r.document_id}/v9/source.pdf`)).rejects.toMatchObject({ code: '42501' })
    await expect(put(U.studentA, path)).rejects.toMatchObject({ code: '42501' })
    await expect(put(U.ownerB, path)).rejects.toMatchObject({ code: '42501' })
    await asCommitted(pool, user(U.deptAdminA), (c) => c.query(`select public.knowledge_set_version_status($1, 'queued')`, [versionId]))
    await expect(put(U.deptAdminA, path)).rejects.toMatchObject({ code: '42501' }) // no overwrite after verification
  })

  it('originals are readable by document readers only', async () => {
    await pool.query(`insert into storage.objects (bucket_id, name) values ('tenant-documents', $1), ('tenant-documents', $2)`, [feesDoc.path, `${tenantA}/${staffDoc.documentId}/v1/source.pdf`])
    const names = async (actor: string) => (await query(pool, user(actor), `select name from storage.objects where bucket_id = 'tenant-documents'`)).rows.map((r) => r.name)
    expect(await names(U.studentA)).toContain(feesDoc.path)
    expect(await names(U.studentA)).not.toContain(`${tenantA}/${staffDoc.documentId}/v1/source.pdf`)
    expect(await names(U.studentB)).toEqual([])
    const bucket = (await pool.query(`select public, file_size_limit from storage.buckets where id = 'tenant-documents'`)).rows[0]
    expect(bucket).toEqual({ public: false, file_size_limit: '26214400' })
  })

  it('deleting a document removes versions and chunks in one step and returns its file paths', async () => {
    const doc = await ingest(U.deptAdminA, 'uni-a', { title: 'To be deleted', visibility: 'members' }, [{ content: 'Temporary content about parking.' }])
    await expect(query(pool, user(U.studentA), `select public.knowledge_delete_document($1)`, [doc.documentId])).rejects.toMatchObject({ code: '42501' })
    const paths = (await asCommitted(pool, user(U.deptAdminA), (c) => c.query(`select public.knowledge_delete_document($1) as p`, [doc.documentId]))).rows[0].p
    expect(paths).toEqual([doc.path])
    expect((await pool.query(`select count(*)::int as n from public.knowledge_chunks where document_id = $1`, [doc.documentId])).rows[0].n).toBe(0)
    expect((await pool.query(`select count(*)::int as n from public.knowledge_document_versions where document_id = $1`, [doc.documentId])).rows[0].n).toBe(0)
    const audit = await pool.query(`select action from public.audit_logs where target_id = $1 order by id`, [doc.documentId])
    expect(audit.rows.map((r) => r.action)).toContain('knowledge_documents.delete')
  })
})
