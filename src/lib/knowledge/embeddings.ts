import 'server-only'
import { getServerEnv } from '@/lib/env/server'

/**
 * Embedding provider abstraction (docs/ai-architecture.md). Anthropic does not offer an
 * embeddings endpoint, so retrieval uses a separate provider chosen by a benchmark on
 * Arabic/English university documents (ADR-021). Until EMBEDDINGS_PROVIDER, EMBEDDINGS_MODEL
 * and EMBEDDINGS_API_KEY are configured, getEmbeddingProvider() returns null and retrieval
 * runs on full-text search only. That is a supported, tested mode, not a fallback that
 * pretends to be semantic search.
 *
 * Status: the HTTP clients below are written to the providers' documented APIs but have NOT
 * been exercised against a live key in this repository yet.
 */

export interface EmbeddingProvider {
  /** Stored with every vector; retrieval only compares vectors of the same model. */
  readonly model: string
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>
}

const BATCH = 64

async function postJson(url: string, key: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`embeddings request failed with HTTP ${response.status}`)
  return response.json()
}

function parseVectors(payload: unknown, expected: number): number[][] {
  const data = (payload as { data?: { embedding?: unknown; index?: number }[] }).data
  if (!Array.isArray(data) || data.length !== expected) throw new Error('embeddings response has an unexpected shape')
  return [...data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => {
      if (!Array.isArray(d.embedding) || !d.embedding.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        throw new Error('embeddings response contains an invalid vector')
      }
      return d.embedding as number[]
    })
}

function httpProvider(model: string, call: (batch: string[], kind: 'document' | 'query') => Promise<unknown>): EmbeddingProvider {
  return {
    model,
    async embed(texts, kind) {
      const out: number[][] = []
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH)
        out.push(...parseVectors(await call(batch, kind), batch.length))
      }
      return out
    },
  }
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const env = getServerEnv()
  if (!env.EMBEDDINGS_PROVIDER || !env.EMBEDDINGS_MODEL || !env.EMBEDDINGS_API_KEY) return null
  const { EMBEDDINGS_MODEL: model, EMBEDDINGS_API_KEY: key } = env
  switch (env.EMBEDDINGS_PROVIDER) {
    case 'voyage':
      return httpProvider(model, (input, kind) => postJson('https://api.voyageai.com/v1/embeddings', key, { model, input, input_type: kind }))
    case 'openai':
      return httpProvider(model, (input) => postJson('https://api.openai.com/v1/embeddings', key, { model, input }))
  }
}

/** pgvector text literal, e.g. "[0.1,0.2]". */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}
