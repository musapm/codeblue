import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import type { FieldErrors } from './schemas'

export type AuthErrorKey = keyof Dictionary['auth']['errors']

export type AuthActionState = {
  status: 'idle' | 'error' | 'success'
  error?: AuthErrorKey
  fieldErrors?: FieldErrors
  /** Echo of the submitted email so the field is not cleared after an error. */
  email?: string
}

export const initialAuthState: AuthActionState = { status: 'idle' }

/** Map Supabase Auth error codes to user-facing message keys (never leak raw errors). */
export function mapAuthErrorCode(code: string | undefined): AuthErrorKey {
  switch (code) {
    case 'invalid_credentials':
      return 'invalidCredentials'
    case 'email_not_confirmed':
      return 'emailNotConfirmed'
    case 'weak_password':
      return 'weakPassword'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rateLimited'
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
      return 'linkExpired'
    default:
      return 'generic'
  }
}
