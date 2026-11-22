import 'server-only'
import { createServerClient } from '@supabase/ssr'
import type { Database } from './database.types'
import { cookies } from 'next/headers'
import { AppError } from '@/lib/errors'
import { getSupabaseConfig } from './config'

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Uses the publishable (anon) key plus the user's session cookies, so every query runs
 * as the signed-in user and Row Level Security applies. The service-role key is never
 * used here (see docs/tenant-isolation.md, rule 4).
 */
export async function createSupabaseServerClient() {
  const config = getSupabaseConfig()
  if (!config) throw new AppError('not_configured', 'Supabase is not configured')

  const cookieStore = await cookies()
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy
          // refreshes the session cookie on the next request, so this is safe to ignore.
        }
      },
    },
  })
}
