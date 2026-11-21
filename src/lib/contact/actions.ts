'use server'

import { headers } from 'next/headers'
import { toFieldErrors, type FieldErrors } from '@/lib/auth/schemas'
import { platformBranding } from '@/lib/branding/platform'
import { clientIpFromHeaders, createMemoryRateLimiter } from '@/lib/rate-limit'
import { buildInquiryMailto, contactSchema } from './schema'

export type ContactActionState =
  | { status: 'idle' }
  | { status: 'error'; fieldErrors?: FieldErrors; rateLimited?: boolean }
  | { status: 'not_stored'; mailto: string }

const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 60 * 60_000 })

/**
 * Validates a demo/contact inquiry.
 *
 * Phase 1: there is no database yet, so the inquiry is NOT stored or sent. The action says
 * so explicitly and returns a pre-filled mailto: link instead. Phase 2 stores consented
 * inquiries in `platform_inquiries` (see TASKS.md).
 */
export async function submitInquiry(_prev: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const ip = clientIpFromHeaders(await headers())
  if (!limiter.check(`inquiry:${ip}`).allowed) return { status: 'error', rateLimited: true }

  const parsed = contactSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    organization: formData.get('organization'),
    role: formData.get('role') ?? undefined,
    country: formData.get('country') ?? undefined,
    message: formData.get('message'),
    consent: formData.get('consent'),
  })
  if (!parsed.success) return { status: 'error', fieldErrors: toFieldErrors(parsed.error) }

  return {
    status: 'not_stored',
    mailto: buildInquiryMailto(platformBranding.salesEmail, parsed.data, `${platformBranding.name} inquiry`),
  }
}
