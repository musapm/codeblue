import 'server-only'
import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { getServerEnv } from '@/lib/env/server'
import { localizedPath, type Locale } from '@/lib/i18n/config'
import { logger } from '@/lib/logger'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPreviewModeActive, PREVIEW_IDENTITY } from './preview'

/**
 * Data Access Layer entry point for identity. Every protected page and Server Action
 * calls `requireUser()` (or a function built on it) — never trust the proxy alone.
 */

export type SessionUser = {
  id: string
  email: string | null
  fullName: string | null
  isPreview: boolean
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  // Ensure this runs at request time, never during prerendering at build time.
  await connection()

  if (!isSupabaseConfigured()) {
    const preview = isPreviewModeActive({ flagEnabled: getServerEnv().UNIAGENT_UI_PREVIEW, supabaseConfigured: false })
    return preview ? { id: PREVIEW_IDENTITY.id, email: PREVIEW_IDENTITY.email, fullName: null, isPreview: true } : null
  }

  try {
    const supabase = await createSupabaseServerClient()
    // getUser() verifies the session with the Auth server (authoritative).
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    const meta = data.user.user_metadata as Record<string, unknown> | undefined
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      fullName: typeof meta?.full_name === 'string' ? meta.full_name : null,
      isPreview: false,
    }
  } catch (error) {
    logger.error('auth.get_user_failed', { error })
    return null
  }
}

export async function requireUser(locale: Locale, nextPath?: string): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) {
    const login = localizedPath(locale, '/login')
    redirect(nextPath ? `${login}?next=${encodeURIComponent(nextPath)}` : login)
  }
  return user
}
