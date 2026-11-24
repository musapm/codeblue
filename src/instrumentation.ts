import type { Instrumentation } from 'next'

/** Server error reporting (Phase 17): see src/lib/monitoring/errors.ts. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { reportRequestError } = await import('@/lib/monitoring/errors')
  await reportRequestError(error, request, context)
}
