/**
 * Application errors with safe, user-facing messages.
 *
 * Internal details (stack traces, SQL errors, provider responses) stay in server logs;
 * the client only ever receives a stable `code` and a reference ID.
 */

export const ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation',
  'rate_limited',
  'not_configured',
  'conflict',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  rate_limited: 429,
  not_configured: 503,
  conflict: 409,
  internal: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  /** Extra details safe to show to the user (e.g. retry-after seconds). */
  readonly publicDetails?: Record<string, string | number>

  constructor(code: ErrorCode, message?: string, options?: { cause?: unknown; publicDetails?: Record<string, string | number> }) {
    super(message ?? code, { cause: options?.cause })
    this.name = 'AppError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.publicDetails = options?.publicDetails
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export type PublicError = {
  code: ErrorCode
  status: number
  referenceId: string
  details?: Record<string, string | number>
}

export function createReferenceId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/** Convert any thrown value to a response-safe shape. Unknown errors become `internal`. */
export function toPublicError(error: unknown, referenceId: string = createReferenceId()): PublicError {
  if (isAppError(error)) {
    return { code: error.code, status: error.status, referenceId, details: error.publicDetails }
  }
  return { code: 'internal', status: 500, referenceId }
}
