import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseConfig } from './config'

/**
 * Refreshes the Supabase session cookie inside `proxy.ts` and reports whether a valid
 * session exists. This is an optimistic check for redirects only; authorization happens
 * in the Data Access Layer and in Row Level Security.
 */
export async function updateSupabaseSession(
  request: NextRequest,
  response: NextResponse,
): Promise<{ response: NextResponse; hasSession: boolean }> {
  const config = getSupabaseConfig()
  if (!config) return { response, hasSession: false }

  let current = response
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        const next = NextResponse.next({ request })
        // Preserve headers set earlier in the proxy (e.g. rewrites) on the new response.
        current.headers.forEach((value, key) => next.headers.set(key, value))
        for (const { name, value, options } of cookiesToSet) next.cookies.set(name, value, options)
        for (const [key, value] of Object.entries(headers ?? {})) next.headers.set(key, value)
        current = next
      },
    },
  })

  // getClaims() validates the JWT (locally with asymmetric keys) and refreshes if needed.
  const { data, error } = await supabase.auth.getClaims()
  return { response: current, hasSession: !error && Boolean(data?.claims?.sub) }
}
