import { z } from 'zod'
import type { ValidationKey } from '@/lib/auth/schemas'

const msg = (key: ValidationKey) => ({ error: key })

const text = (max: number, requiredKey: ValidationKey) =>
  z.string(msg(requiredKey)).trim().min(1, msg(requiredKey)).max(max, msg('nameTooLong'))

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, msg('nameTooLong'))
    .optional()
    .transform((v) => (v ? v : undefined))

export const contactSchema = z.object({
  name: text(120, 'nameRequired'),
  email: z
    .string(msg('emailRequired'))
    .trim()
    .min(1, msg('emailRequired'))
    .max(254, msg('emailInvalid'))
    .pipe(z.email(msg('emailInvalid'))),
  organization: text(160, 'organizationRequired'),
  role: optionalText(120),
  country: optionalText(80),
  message: z.string(msg('messageTooShort')).trim().min(20, msg('messageTooShort')).max(2000, msg('messageTooLong')),
  // Explicit, recorded consent is required before any contact details are processed.
  consent: z.literal('on', msg('consentRequired')),
})

export type ContactInput = z.infer<typeof contactSchema>

/** Build a mailto: link so the visitor can send the inquiry from their own email client. */
export function buildInquiryMailto(to: string, input: ContactInput, subjectPrefix: string): string {
  const lines = [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Organization: ${input.organization}`,
    input.role ? `Role: ${input.role}` : null,
    input.country ? `Country: ${input.country}` : null,
    '',
    input.message,
  ].filter((line): line is string => line !== null)
  const params = new URLSearchParams({ subject: `${subjectPrefix} — ${input.organization}`, body: lines.join('\n') })
  // URLSearchParams encodes spaces as "+", which mail clients do not decode.
  return `mailto:${encodeURIComponent(to)}?${params.toString().replace(/\+/g, '%20')}`
}
