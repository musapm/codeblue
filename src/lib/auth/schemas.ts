import { z } from 'zod'
import type { Dictionary } from '@/lib/i18n/dictionaries/en'

/**
 * Auth form schemas. Error messages are dictionary *keys* (not text), so the same
 * server-side validation works for every locale; the form translates them.
 */

export type ValidationKey = keyof Dictionary['validation']

const msg = (key: ValidationKey) => ({ error: key })

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 72 // bcrypt limit used by Supabase Auth

const email = z
  .string(msg('emailRequired'))
  .trim()
  .min(1, msg('emailRequired'))
  .max(254, msg('emailInvalid'))
  .pipe(z.email(msg('emailInvalid')))
  .transform((v) => v.toLowerCase())

const newPassword = z
  .string(msg('passwordRequired'))
  .min(1, msg('passwordRequired'))
  .min(PASSWORD_MIN, msg('passwordTooShort'))
  .max(PASSWORD_MAX, msg('passwordTooLong'))

export const signInSchema = z.object({
  email,
  password: z.string(msg('passwordRequired')).min(1, msg('passwordRequired')).max(PASSWORD_MAX, msg('passwordTooLong')),
})

export const signUpSchema = z.object({
  fullName: z.string(msg('nameRequired')).trim().min(1, msg('nameRequired')).max(120, msg('nameTooLong')),
  email,
  password: newPassword,
})

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string(msg('passwordRequired')) })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], ...msg('passwordsDoNotMatch') })

export type FieldErrors = Partial<Record<string, ValidationKey>>

/** Flatten zod issues to `{ field: firstErrorKey }`. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form')
    if (!out[field]) out[field] = (issue.message as ValidationKey) || 'invalidValue'
  }
  return out
}
