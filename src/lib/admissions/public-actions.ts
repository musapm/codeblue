'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { toFieldErrors, type FieldErrors } from '@/lib/auth/schemas'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { logger } from '@/lib/logger'
import { clientIpFromHeaders, createMemoryRateLimiter } from '@/lib/rate-limit'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { consentFor } from './public'
import { ensureVisitorSession, getPublicAdmissions, type VisitorSessionError } from './visitor'

/** Public admissions Server Actions (visitors; anonymous sessions allowed). */

const log = logger.child({ module: 'admissions.public' })
const inquiryLimiter = createMemoryRateLimiter({ limit: 10, windowMs: 10 * 60_000 })

function captcha(formData: FormData): string | undefined {
  const v = formData.get('captchaToken')
  return typeof v === 'string' && v.length > 0 && v.length <= 4096 ? v : undefined
}

/** "Start chatting": make sure the visitor has a session before the first question. */
export async function startVisitorSession(input: { captchaToken?: string }): Promise<{ ok: true } | { ok: false; error: VisitorSessionError }> {
  const token = typeof input.captchaToken === 'string' && input.captchaToken.length <= 4096 ? input.captchaToken : undefined
  return ensureVisitorSession(token || undefined)
}

export type InquiryErrorKey = 'tooMany' | 'unavailable' | 'consentChanged' | 'sessionDisabled' | 'captcha' | 'rateLimited' | 'invalid' | 'generic'
export type InquiryState =
  | { status: 'idle' }
  | { status: 'success'; reference: string; at: number }
  | { status: 'error'; error: InquiryErrorKey; fieldErrors?: FieldErrors; at: number }

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'nameTooLong' })
    .optional()
    .transform((v) => (v ? v : undefined))

const inquirySchema = z
  .object({
    fullName: z.string({ error: 'nameRequired' }).trim().min(2, { error: 'nameRequired' }).max(120, { error: 'nameTooLong' }),
    email: z
      .string()
      .trim()
      .max(254, { error: 'emailInvalid' })
      .optional()
      .transform((v) => (v ? v.toLowerCase() : undefined))
      .pipe(z.email({ error: 'emailInvalid' }).optional()),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.string().regex(/^[+]?[0-9 ()-]{6,32}$/, { error: 'phoneInvalid' }).optional()),
    country: optionalText(80),
    programId: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.uuid({ error: 'invalidValue' }).optional()),
    intake: optionalText(60),
    message: optionalText(2000),
    consent: z.literal('on', { error: 'consentRequired' }),
  })
  .refine((v) => v.email || v.phone, { path: ['email'], error: 'contactRequired' })

export async function submitInquiry(_prev: InquiryState, formData: FormData): Promise<InquiryState> {
  const fail = (error: InquiryErrorKey, fieldErrors?: FieldErrors): InquiryState => ({ status: 'error', error, fieldErrors, at: Date.now() })
  const slug = z.string().regex(/^[a-z0-9-]{1,48}$/).safeParse(formData.get('tenant'))
  const locale = formData.get('locale') === 'ar' ? 'ar' : 'en'
  if (!slug.success) return fail('invalid')

  const get = (k: string) => {
    const v = formData.get(k)
    return typeof v === 'string' ? v : undefined
  }
  const parsed = inquirySchema.safeParse({
    fullName: get('fullName'),
    email: get('email'),
    phone: get('phone'),
    country: get('country'),
    programId: get('programId'),
    intake: get('intake'),
    message: get('message'),
    consent: get('consent'),
  })
  if (!parsed.success) return fail('invalid', toFieldErrors(parsed.error))

  const ip = clientIpFromHeaders(await headers())
  if (!inquiryLimiter.check(`inquiry:${ip}`).allowed) return fail('rateLimited')

  const page = await getPublicAdmissions(slug.data)
  if (!page) return fail('unavailable')

  // The consent wording is decided here, from the same settings the page was rendered from.
  // If it changed after the visitor loaded the page, they must read and confirm it again.
  const dict = getDictionary(locale)
  const universityName = (locale === 'ar' && page.tenant.name_translations.ar) || page.tenant.name
  const consent = consentFor(page, locale, dict.admissions.public.defaultConsent(universityName))
  if (get('consentVersion') !== consent.version) return fail('consentChanged')

  const session = await ensureVisitorSession(captcha(formData))
  if (!session.ok) return fail(session.error === 'notConfigured' ? 'unavailable' : session.error)

  const conversation = z.uuid().safeParse(get('conversationId'))
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('admissions_submit_lead', {
    p_tenant_slug: slug.data,
    p_full_name: parsed.data.fullName,
    p_email: parsed.data.email ?? null,
    p_phone: parsed.data.phone ?? null,
    p_country: parsed.data.country ?? null,
    p_program: parsed.data.programId ?? null,
    p_intake: parsed.data.intake ?? null,
    p_message: parsed.data.message ?? null,
    p_locale: locale,
    p_consent_version: consent.version,
    p_consent_text: consent.text,
    p_conversation: conversation.success ? conversation.data : null,
  })
  if (error) {
    switch (error.code) {
      case '54000':
        return fail('tooMany')
      case '42501':
        return fail('unavailable')
      case '22023':
      case '23514':
        return fail('invalid')
      default:
        log.error('admissions.inquiry_failed', { code: error.code })
        return fail('generic')
    }
  }
  const reference = (data as { reference?: string } | null)?.reference
  return reference ? { status: 'success', reference, at: Date.now() } : fail('generic')
}
