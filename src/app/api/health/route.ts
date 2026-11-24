import { appVersion } from '@/lib/monitoring/errors'
import { getSupabaseConfig, isSupabaseConfigured } from '@/lib/supabase/config'

/**
 * Liveness/readiness probe for uptime monitors and deploy checks. Exposes no secrets, only
 * whether dependencies are configured and the app version. `?deep=1` also asks Supabase Auth
 * whether it is up (3-second timeout) and answers 503 when it is not.
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1'
  const checks: Record<string, string> = { supabase: isSupabaseConfigured() ? 'configured' : 'not_configured' }
  let healthy = true
  if (deep) {
    const config = getSupabaseConfig()
    if (!config) checks.auth = 'not_configured'
    else {
      try {
        const res = await fetch(`${config.url}/auth/v1/health`, { headers: { apikey: config.publishableKey }, signal: AbortSignal.timeout(3000), cache: 'no-store' })
        checks.auth = res.ok ? 'ok' : `error_${res.status}`
        healthy = res.ok
      } catch {
        checks.auth = 'unreachable'
        healthy = false
      }
    }
  }
  return Response.json(
    { status: healthy ? 'ok' : 'degraded', time: new Date().toISOString(), version: appVersion(), checks },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
