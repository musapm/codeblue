import { isSupabaseConfigured } from '@/lib/supabase/config'

/**
 * Liveness/readiness probe for uptime monitors and deploy checks.
 * Exposes no secrets — only whether dependencies are configured.
 */
export async function GET() {
  return Response.json(
    {
      status: 'ok',
      time: new Date().toISOString(),
      checks: { supabase: isSupabaseConfigured() ? 'configured' : 'not_configured' },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
