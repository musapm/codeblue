import 'server-only'
import type { FormMessages } from '@/components/management/action-form'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import type { Locale } from '@/lib/i18n/config'
import type { WorkspaceContext } from '@/lib/tenancy/context'

export const TENANT_STATUS_VARIANT = { trial: 'info', active: 'success', suspended: 'warning', archived: 'neutral' } as const

/** Plain-string messages for client forms (dictionary functions cannot cross to the client). */
export function formMessages(dict: Dictionary): FormMessages {
  return { errors: dict.management.errors, validation: dict.validation, saved: dict.management.saved }
}

export function formatDate(locale: Locale, iso: string | null | undefined, withTime = false): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso))
}

export function roleLabel(dict: Dictionary, key: string, fallback?: string): string {
  return dict.management.roles[key] ?? fallback ?? key
}

/**
 * Whether write controls are shown. Preview has no data; support access is read-only by
 * design (the database rejects writes anyway, this only avoids offering dead buttons).
 */
export function writeMode(ctx: WorkspaceContext, dict: Dictionary): { canWrite: boolean; notice?: string } {
  if (ctx.user.isPreview) return { canWrite: false, notice: dict.management.previewNotice }
  if (ctx.accessVia === 'support') return { canWrite: false, notice: dict.management.supportNotice }
  return { canWrite: true }
}

type AuditSource = { id: number; actorId: string | null; actorType: string; action: string; changedFields: string[]; createdAt: string; tenantId: string | null }

/** Map audit rows to display rows: translated action, actor name when known. */
export function toAuditView(
  dict: Dictionary,
  locale: Locale,
  rows: AuditSource[],
  names: Map<string, string>,
  tenants?: Map<string, string>,
) {
  const a = dict.management.audit
  return rows.map((r) => ({
    id: r.id,
    time: formatDate(locale, r.createdAt, true),
    actor: r.actorId ? (names.get(r.actorId) ?? `${a.unknownUser} ${r.actorId.slice(0, 8)}`) : a.system,
    actorKind: (r.actorType === 'platform_admin' || r.actorType === 'system' ? r.actorType : 'user') as 'user' | 'platform_admin' | 'system',
    action: a.actions[r.action] ?? r.action,
    details: r.changedFields.length ? a.changed(r.changedFields.join(', ')) : '',
    tenant: r.tenantId ? (tenants?.get(r.tenantId) ?? r.tenantId.slice(0, 8)) : '—',
  }))
}

export function auditLabels(dict: Dictionary) {
  const a = dict.management.audit
  return { time: a.time, actor: a.actor, action: a.action, details: a.details, tenant: a.tenant, empty: a.empty, older: a.older, newest: a.newest, platformStaff: a.platformStaff }
}
