import type { FeatureKey } from '@/lib/features/catalog'
import type { PermissionKey } from '@/lib/permissions/catalog'

/**
 * Navigation model for the tenant workspace and the platform console.
 *
 * Pure data (no React), so it can be shared by server code (authorization, routing) and
 * client code (active-link highlighting). Hiding an item here is a UX convenience only —
 * the pages and actions behind each item enforce permissions and features server-side.
 */

export type NavStatus = 'available' | 'planned'

export type NavItem = {
  key: string
  /** Path segment under the workspace root ('' = overview). */
  segment: string
  icon: NavIconName
  status: NavStatus
  phase: number
  permission?: PermissionKey
  /** Feature the university must have on; with a list, any one of them is enough. */
  feature?: FeatureKey | readonly FeatureKey[]
}

export type NavSection = { key: string; items: NavItem[] }

export type NavIconName =
  | 'overview'
  | 'assistant'
  | 'admissions'
  | 'academic'
  | 'staff'
  | 'tickets'
  | 'requests'
  | 'services'
  | 'voice'
  | 'courses'
  | 'knowledge'
  | 'workflows'
  | 'campus'
  | 'analytics'
  | 'quality'
  | 'members'
  | 'departments'
  | 'integrations'
  | 'settings'
  | 'audit'
  | 'tenants'
  | 'plans'
  | 'usage'
  | 'ai'

export const WORKSPACE_NAV: NavSection[] = [
  {
    key: 'main',
    items: [
      { key: 'overview', segment: '', icon: 'overview', status: 'available', phase: 1 },
      { key: 'ask', segment: 'ask', icon: 'assistant', status: 'available', phase: 5, permission: 'assistant.use', feature: 'student_assistant' },
      { key: 'courses', segment: 'courses', icon: 'courses', status: 'available', phase: 9, permission: 'academic.use', feature: 'academic_agent' },
      { key: 'requests', segment: 'requests', icon: 'requests', status: 'available', phase: 7, permission: 'tickets.read_own', feature: 'ticketing' },
      { key: 'services', segment: 'services', icon: 'services', status: 'available', phase: 11, permission: 'tickets.create', feature: 'workflow_agent' },
      { key: 'campus', segment: 'campus', icon: 'campus', status: 'available', phase: 12, feature: 'campus_assistant' },
    ],
  },
  {
    key: 'assistants',
    items: [
      { key: 'assistant', segment: 'assistant', icon: 'ai', status: 'available', phase: 5, permission: 'assistant.configure', feature: 'student_assistant' },
      { key: 'admissions', segment: 'admissions', icon: 'admissions', status: 'available', phase: 6, permission: 'leads.read', feature: 'admissions_agent' },
      { key: 'academic', segment: 'academic', icon: 'academic', status: 'available', phase: 9, permission: 'academic.manage', feature: 'academic_agent' },
      { key: 'staff-assistant', segment: 'staff-assistant', icon: 'staff', status: 'available', phase: 10, permission: 'assistant.staff.use', feature: 'staff_assistant' },
      { key: 'voice', segment: 'voice', icon: 'voice', status: 'available', phase: 13, permission: 'assistant.configure', feature: 'voice' },
    ],
  },
  {
    key: 'operations',
    items: [
      { key: 'tickets', segment: 'tickets', icon: 'tickets', status: 'available', phase: 7, permission: 'tickets.read_department', feature: 'ticketing' },
      { key: 'knowledge', segment: 'knowledge', icon: 'knowledge', status: 'available', phase: 4, permission: 'knowledge.manage', feature: 'knowledge_base' },
      { key: 'workflows', segment: 'workflows', icon: 'workflows', status: 'available', phase: 11, permission: 'tickets.update', feature: 'workflow_agent' },
    ],
  },
  {
    key: 'insights',
    items: [
      { key: 'analytics', segment: 'analytics', icon: 'analytics', status: 'available', phase: 8, permission: 'analytics.view', feature: 'analytics_basic' },
      { key: 'quality', segment: 'quality', icon: 'quality', status: 'available', phase: 8, permission: 'quality.review', feature: ['student_assistant', 'admissions_agent'] },
    ],
  },
  {
    key: 'administration',
    items: [
      { key: 'members', segment: 'members', icon: 'members', status: 'available', phase: 3, permission: 'members.read' },
      { key: 'departments', segment: 'departments', icon: 'departments', status: 'available', phase: 3, permission: 'departments.manage' },
      { key: 'integrations', segment: 'integrations', icon: 'integrations', status: 'available', phase: 14, permission: 'integrations.manage', feature: 'integrations' },
      { key: 'audit', segment: 'audit', icon: 'audit', status: 'available', phase: 3, permission: 'audit.read' },
      { key: 'settings', segment: 'settings', icon: 'settings', status: 'available', phase: 1, permission: 'tenant.settings.read' },
    ],
  },
]

export const PLATFORM_NAV: NavSection[] = [
  {
    key: 'main',
    items: [
      { key: 'overview', segment: '', icon: 'overview', status: 'available', phase: 1 },
      { key: 'tenants', segment: 'tenants', icon: 'tenants', status: 'available', phase: 3 },
      { key: 'plans', segment: 'plans', icon: 'plans', status: 'planned', phase: 15 },
      { key: 'usage', segment: 'usage', icon: 'usage', status: 'planned', phase: 15 },
      { key: 'ai', segment: 'ai', icon: 'ai', status: 'planned', phase: 5 },
      { key: 'audit', segment: 'audit', icon: 'audit', status: 'available', phase: 3 },
      { key: 'settings', segment: 'settings', icon: 'settings', status: 'planned', phase: 15 },
    ],
  },
]

export type AccessSnapshot =
  | { kind: 'all' } // UI preview: show every item (no data behind it)
  | { kind: 'scoped'; permissions: ReadonlySet<string>; features: ReadonlySet<string> }

export function canSeeNavItem(item: NavItem, access: AccessSnapshot): boolean {
  if (access.kind === 'all') return true
  if (item.permission && !access.permissions.has(item.permission)) return false
  if (item.feature) {
    const needed: readonly FeatureKey[] = typeof item.feature === 'string' ? [item.feature] : item.feature
    if (!needed.some((f) => access.features.has(f))) return false
  }
  return true
}

export function filterNav(sections: NavSection[], access: AccessSnapshot): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => canSeeNavItem(item, access)) }))
    .filter((section) => section.items.length > 0)
}

export function findNavItem(sections: NavSection[], segment: string): NavItem | undefined {
  return sections.flatMap((s) => s.items).find((item) => item.segment === segment)
}

export function plannedSegments(sections: NavSection[]): string[] {
  return sections.flatMap((s) => s.items).filter((i) => i.status === 'planned').map((i) => i.segment)
}
