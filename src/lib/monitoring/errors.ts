import { logger, redact } from '@/lib/logger'

/**
 * Server error reports (Phase 17). Every error Next.js captures (rendering, route handlers,
 * Server Actions, the proxy) is logged as one structured line, with personal data removed by the
 * logger. With ERROR_REPORT_URL set, the same redacted report is also POSTed there (a log
 * pipeline, an incident channel or an error tracker's ingest URL). No query strings, headers or
 * request bodies are reported.
 */

export type RequestErrorContext = { routePath?: string; routeType?: string }
export type ErrorReport = { level: 'error'; route: string | null; type: string | null; method: string; path: string; digest: string | null; name: string; message: string; version: string | null; time: string }

const log = logger.child({ module: 'monitoring' })

export function buildErrorReport(error: unknown, request: { path: string; method: string }, context: RequestErrorContext, now = new Date()): ErrorReport {
  const e = error instanceof Error ? error : null
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest: unknown }).digest) : null
  const report: ErrorReport = {
    level: 'error',
    route: context.routePath ?? null,
    type: context.routeType ?? null,
    method: request.method,
    path: request.path.split('?')[0]!.slice(0, 300),
    digest,
    name: e?.name ?? typeof error,
    message: (e?.message ?? String(error)).slice(0, 500),
    version: appVersion(),
    time: now.toISOString(),
  }
  return redact(report) as ErrorReport
}

export function appVersion(env: Record<string, string | undefined> = process.env): string | null {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? env.APP_VERSION ?? null
}

export async function reportRequestError(error: unknown, request: { path: string; method: string }, context: RequestErrorContext): Promise<void> {
  const report = buildErrorReport(error, request, context)
  log.error('request.error', report)
  const url = process.env.ERROR_REPORT_URL
  if (!url || !/^https:\/\//.test(url)) return
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(2000) })
  } catch {
    log.warn('request.error_report_failed')
  }
}
