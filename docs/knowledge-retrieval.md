# Knowledge Ingestion & Retrieval (RAG)

> Status: **Phase 4 implemented** (migration 8, `src/lib/knowledge/*`); retrieval in chat is Phase 5.
> Differences from the design below:
> - Retrieval is `public.search_knowledge` (SECURITY DEFINER with explicit, caller-scoped checks applied before ranking; it replaces `app.match_chunks`).
> - Processing runs in `after()` with the uploader's session until a worker exists (ADR-022).
> - Embeddings wait for a provider decision (ADR-021).
> - Arabic PDFs are rebuilt in reading order from glyph positions (`pdf-bidi.ts`).

## 1. Ingestion pipeline

```
upload (Server Action, permission knowledge.manage, feature knowledge_base)
  → validate: extension + magic bytes + size limit (plan-configurable, default 25 MB) + virus-scan hook
  → store: private bucket `tenant-documents/<tenant_id>/<document_id>/v<version>/<file>`
  → row in documents (status = 'queued') + job in jobs
worker:
  → extract text per page (PDF: pdf.js-based extractor; DOCX: mammoth; TXT/CSV: direct; HTML: sanitized → text)
  → normalize (Unicode NFKC, Arabic normalization for search: alef/yaa/taa-marbuta variants, tatweel removal)
  → chunk (structure-aware: headings/paragraphs, ~500–800 tokens, 10–15% overlap, page numbers kept)
  → embed (EmbeddingProvider, batched, retried with backoff)
  → write document_chunks (content, page, tsvector, embedding, embedding_model)
  → status = 'ready' (or 'failed' with a safe error message for the admin UI)
```

- **Scanned PDFs** with no text layer are flagged `needs_ocr`. OCR is a later enhancement.
- **Re-upload or replace** creates a new `document_versions` row. Old chunks are removed when the new
  version becomes active, so retrieval never mixes versions.
- **Deletion** (authorized and audited) deletes chunks and embeddings in the same transaction and removes
  storage objects through a job.
- **Embedding model changes** trigger a background re-embed. Each chunk stores `embedding_model`, and
  retrieval only compares vectors from the same model.

## 2. Metadata

`documents`: tenant, title (per-locale optional), file type, department, category, owner, version,
effective date, expiry date, upload date, uploaded by, **visibility**, source URL, processing status and
errors, `is_authoritative`, `is_outdated`, `source_priority`.

**Visibility levels**

| Level | Who can retrieve |
| --- | --- |
| `public` | Anyone using the tenant portal, including anonymous applicants |
| `members` | Any authenticated tenant member (students and staff) |
| `staff` | Members holding `knowledge.read_internal` |
| `restricted` | Only roles or departments listed in `document_access` |

## 3. Retrieval

`app.match_chunks(query_embedding, query_text, k, filters jsonb)` is a SQL function executed with the
**caller's JWT**:

1. Resolves tenant membership and audience (anonymous / member / staff / roles / departments) from the JWT.
2. Filters chunks by `tenant_id`, document status `ready`, not expired, not archived, and visibility rules.
   This filtering happens **before** ranking.
3. Hybrid ranking: vector similarity (HNSW index, cosine) **and** full-text rank (`tsvector`; an `arabic`
   config for Arabic text, `simple` for mixed text), fused with Reciprocal Rank Fusion.
4. Boosts: `is_authoritative`, `source_priority`, recency of `effective_date`. Outdated documents are demoted.
5. Returns chunk content, document title, page, version, effective date, and source URL. These are the
   only things the AI sees.

**Embedding model selection** happens in Phase 4 via a small Arabic/English retrieval benchmark on the
demo tenant. Candidates are multilingual embedding models from Voyage AI, OpenAI, and Cohere (Anthropic
does not offer an embeddings endpoint). The column dimension is fixed per model, and HNSW indexes are
created per model.

## 4. Citations

The answer's citations come from the provider's citation mechanism, which points into the documents we
supplied, mapped back to `document_chunks`. Each citation displays the **document title, page, version or
effective date, and a link** (a short-lived signed URL for private files, or the public source URL).
Citations that do not map to a retrieved chunk are dropped, and the answer's confidence is lowered.

## 5. Contradiction detection (practical)

When the top results include chunks from **different documents** on the same topic with differing
dates, numbers, or amounts (a lightweight extraction pass), the answer is generated in "conflict mode":
both sources are shown and the user is referred to the responsible department. Admins see these in the
quality review queue.

## 6. Tests (Phase 4/5)

Valid and invalid uploads, oversized files, corrupt PDFs, processing failures and retry, version
replacement, deletion removes chunks, tenant isolation of `match_chunks`, visibility enforcement, Arabic
and English retrieval quality on the demo set, and injection text inside documents.
