import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import { getAiConfig } from '@/lib/ai/config'
import { hasWorkspaceFeature, hasWorkspacePermission, type WorkspaceContext } from '@/lib/tenancy/context'
import type { StaffStatus } from './queries'

/** Small shared helpers for the staff assistant pages (server only: reads the AI config). */

/** The ticket digest: the staff assistant plus ticketing and a ticket queue (same rule as staff_ai_begin). */
export function canUseDigest(ctx: WorkspaceContext): boolean {
  return (
    hasWorkspacePermission(ctx, 'assistant.staff.use') &&
    hasWorkspaceFeature(ctx, 'ticketing') &&
    (hasWorkspacePermission(ctx, 'tickets.read_department') || hasWorkspacePermission(ctx, 'tickets.read_all'))
  )
}

/** Why the AI tools cannot run right now (null: they can). */
export function staffUnavailable(ctx: WorkspaceContext, status: StaffStatus | null, dict: Dictionary): string | null {
  const u = dict.staff.unavailable
  if (ctx.user.isPreview || !ctx.tenantId) return u.preview!
  if (ctx.accessVia === 'support') return u.support!
  if (!getAiConfig().configured) return u.notConfigured!
  if (!status) return null
  if (!status.canUse) return u.forbidden!
  if (!status.enabled) return u.disabled!
  if (!status.withinBudget) return u.budget!
  return null
}

export function departmentOptions(locale: string, departments: { id: string; name: string; nameAr: string | null; archivedAt: string | null }[], only?: readonly string[]) {
  return departments
    .filter((d) => !d.archivedAt && (!only || only.includes(d.id)))
    .map((d) => ({ value: d.id, label: (locale === 'ar' && d.nameAr) || d.name }))
}
