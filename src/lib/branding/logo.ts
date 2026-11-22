import { getSupabaseConfig } from '@/lib/supabase/config'

const LOGO_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/

/**
 * Public URL of a tenant logo in the `tenant-assets` bucket. The path is re-validated
 * (same rule as app.valid_branding) so a stored value can never point elsewhere.
 */
export function logoPublicUrl(path: unknown): string | undefined {
  const config = getSupabaseConfig()
  if (!config || typeof path !== 'string' || !LOGO_PATH.test(path)) return undefined
  return `${config.url}/storage/v1/object/public/tenant-assets/${path}`
}
