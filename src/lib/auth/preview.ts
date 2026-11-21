/**
 * UI preview mode (ADR-012).
 *
 * Lets the product owner see the workspace shell before an authentication backend exists.
 * It is honoured ONLY when Supabase is not configured — so there is never real data or a
 * real session it could bypass. Once Supabase credentials are present, the flag is ignored.
 */

export type PreviewModeInput = {
  flagEnabled: boolean
  supabaseConfigured: boolean
}

export function isPreviewModeActive({ flagEnabled, supabaseConfigured }: PreviewModeInput): boolean {
  return flagEnabled && !supabaseConfigured
}

export const PREVIEW_IDENTITY = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'preview@example.invalid',
  isPreview: true as const,
}
