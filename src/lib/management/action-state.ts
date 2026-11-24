import type { ValidationKey } from '@/lib/auth/schemas'

/**
 * Result shape shared by all management Server Actions (client-safe: no server imports).
 * Errors are dictionary keys — raw database messages never reach the browser.
 */

export const ACTION_ERRORS = [
  'forbidden',
  'conflict',
  'invalid',
  'notFound',
  'lastOwner',
  'ownerOnly',
  'previewReadOnly',
  'supportReadOnly',
  'notConfigured',
  'rateLimited',
  'inUse',
  'closed',
  'dailyLimit',
  'aiBudget',
  'aiRefused',
  'studyToolsOff',
  'studyBudget',
  'studyRefused',
  'joinLimit',
  'aiNotConfigured',
  'staffOff',
  'formChanged',
  'suggestionsOff',
  'campusOff',
  'generic',
] as const

export type ActionErrorKey = (typeof ACTION_ERRORS)[number]

export type ActionState<T = undefined> =
  | { status: 'idle' }
  | { status: 'success'; data?: T; at: number }
  | { status: 'error'; error: ActionErrorKey; fieldErrors?: Partial<Record<string, ValidationKey>>; at: number }

export const idleState = { status: 'idle' } as const

export type DbError = { code?: string | null; message?: string | null }

/** Map a PostgreSQL / PostgREST / Storage error to a user-facing key. */
export function mapDbError(error: DbError): ActionErrorKey {
  const message = error.message ?? ''
  switch (error.code) {
    case '42501':
      return /ownership/i.test(message) ? 'ownerOnly' : 'forbidden'
    case '23505':
      return 'conflict'
    case '23514':
      return /owner/i.test(message) ? 'lastOwner' : 'invalid'
    case '22023':
    case '22P02':
    case '23502':
    case '23503':
      return 'invalid'
    case 'P0002':
    case 'PGRST116':
      return 'notFound'
    case '55000':
      return 'closed'
    case '54000':
      return 'dailyLimit'
    case '53400':
      return 'aiBudget'
    default:
      // Storage errors carry HTTP-like codes in `statusCode`/`message`.
      if (/row-level security|unauthorized|not authorized/i.test(message)) return 'forbidden'
      if (/payload too large|mime type|file size/i.test(message)) return 'invalid'
      return 'generic'
  }
}

export function errorState(error: ActionErrorKey, fieldErrors?: Partial<Record<string, ValidationKey>>): ActionState<never> {
  return { status: 'error', error, fieldErrors, at: Date.now() }
}

export function successState<T>(data?: T): ActionState<T> {
  return { status: 'success', data, at: Date.now() }
}
