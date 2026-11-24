import 'server-only'
import { publicEnv } from '@/lib/env/public'
import { getServerEnv } from '@/lib/env/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export type ReadinessStatus = 'configured' | 'missing' | 'planned'
export type ReadinessCheck = { key: 'siteUrl' | 'supabase' | 'serviceKey' | 'aiProvider' | 'rateLimits' | 'email'; status: ReadinessStatus; phase?: number }

/**
 * Which services are configured in this deployment. Returns booleans only — secret
 * values are never read into the response.
 */
export function getReadinessChecks(): ReadinessCheck[] {
  const env = getServerEnv()
  const siteUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SITE_URL) && !publicEnv.siteUrl.includes('localhost')
  return [
    { key: 'siteUrl', status: siteUrlConfigured ? 'configured' : 'missing' },
    { key: 'supabase', status: isSupabaseConfigured() ? 'configured' : 'missing', phase: 2 },
    { key: 'serviceKey', status: env.SUPABASE_SECRET_KEY ? 'configured' : 'missing', phase: 4 },
    { key: 'aiProvider', status: env.ANTHROPIC_API_KEY ? 'configured' : 'missing', phase: 5 },
    { key: 'rateLimits', status: env.RATE_LIMIT_SECRET && isSupabaseConfigured() ? 'configured' : 'missing', phase: 16 },
    // No email provider adapter exists yet (ADR-034): a decision for the product owner.
    { key: 'email', status: 'planned', phase: 17 },
  ]
}
