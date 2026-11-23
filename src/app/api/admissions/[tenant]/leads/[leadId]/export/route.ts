import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Download everything stored about one inquiry as JSON (data-subject access requests).
 * Staff with leads.read only (checked by admissions_export_lead), signed-in accounts only
 * (anonymous visitor sessions count as signed out), same-site navigations only because each
 * export writes an audit entry.
 */

const log = logger.child({ module: 'admissions.export' })
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: Request, ctx: { params: Promise<{ tenant: string; leadId: string }> }) {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return Response.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE })
  if (!isSupabaseConfigured()) return Response.json({ error: 'notConfigured' }, { status: 503, headers: NO_STORE })
  const user = await getCurrentUser()
  if (!user || user.isPreview) return Response.json({ error: 'forbidden' }, { status: 401, headers: NO_STORE })

  const { leadId } = await ctx.params
  if (!z.uuid().safeParse(leadId).success) return Response.json({ error: 'notFound' }, { status: 404, headers: NO_STORE })

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('admissions_export_lead', { p_lead: leadId })
  if (error) {
    if (error.code === '42501') return Response.json({ error: 'notFound' }, { status: 404, headers: NO_STORE })
    // The export function arrives with migration 12; until it is applied the database has no such function.
    if (error.code === 'PGRST202') return Response.json({ error: 'notAvailable' }, { status: 503, headers: NO_STORE })
    log.error('admissions.export_failed', { code: error.code })
    return Response.json({ error: 'generic' }, { status: 500, headers: NO_STORE })
  }
  const reference = (data as { inquiry?: { reference?: string } } | null)?.inquiry?.reference ?? 'inquiry'
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reference.replace(/[^A-Za-z0-9-]/g, '')}.json"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
