import { publicEnv, type PublicEnv } from '@/lib/env/public'

export type SupabaseConfig = { url: string; publishableKey: string }

/** Returns the Supabase connection settings, or null when this environment has none. */
export function getSupabaseConfig(env: Pick<PublicEnv, 'supabaseUrl' | 'supabasePublishableKey'> = publicEnv): SupabaseConfig | null {
  if (!env.supabaseUrl || !env.supabasePublishableKey) return null
  return { url: env.supabaseUrl, publishableKey: env.supabasePublishableKey }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null
}
