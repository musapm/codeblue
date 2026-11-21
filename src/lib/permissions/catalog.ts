/**
 * Canonical permission catalog (see docs/authorization.md).
 * Phase 2 seeds the `permissions` table from this list; keys must never be renamed
 * without a migration.
 */

export const PERMISSIONS = {
  'tenant.settings.read': 'View university settings',
  'tenant.settings.manage': 'Manage university settings',
  'tenant.branding.manage': 'Manage branding',
  'tenant.features.read': 'View enabled features',
  'members.read': 'View members',
  'members.invite': 'Invite members',
  'members.manage': 'Manage members',
  'roles.manage': 'Manage roles and permissions',
  'departments.manage': 'Manage departments',
  'knowledge.read_public': 'Read public knowledge',
  'knowledge.read_internal': 'Read internal knowledge',
  'knowledge.manage': 'Upload and manage knowledge sources',
  'knowledge.publish': 'Publish knowledge sources',
  'assistant.use': 'Use the student assistant',
  'assistant.staff.use': 'Use the staff assistant',
  'assistant.configure': 'Configure AI agents',
  'tickets.create': 'Create tickets',
  'tickets.read_own': 'View own tickets',
  'tickets.read_department': 'View department tickets',
  'tickets.read_all': 'View all tickets',
  'tickets.update': 'Update tickets',
  'tickets.assign': 'Assign tickets',
  'tickets.notes.read': 'Read internal ticket notes',
  'tickets.notes.write': 'Write internal ticket notes',
  'leads.read': 'View admissions leads',
  'leads.manage': 'Manage admissions leads',
  'programs.manage': 'Manage programs',
  'academic.use': 'Use academic tools',
  'academic.manage': 'Manage academic content',
  'campus.manage': 'Manage campus locations',
  'analytics.view': 'View analytics',
  'analytics.ai_costs.view': 'View AI usage and costs',
  'quality.review': 'Review AI quality',
  'integrations.manage': 'Manage integrations',
  'audit.read': 'Read audit logs',
} as const

export type PermissionKey = keyof typeof PERMISSIONS

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[]

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value)
}
