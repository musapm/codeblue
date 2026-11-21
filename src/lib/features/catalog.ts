/**
 * Feature (entitlement) catalog. Plans and per-tenant overrides enable these keys;
 * enforcement is server-side (Phase 3). The `phase` field documents when each module
 * is scheduled to be built — the UI uses it to label modules that do not exist yet.
 */

export const FEATURES = {
  knowledge_base: { phase: 4 },
  student_assistant: { phase: 5 },
  admissions_agent: { phase: 6 },
  ticketing: { phase: 7 },
  analytics_basic: { phase: 8 },
  analytics_advanced: { phase: 8 },
  academic_agent: { phase: 9 },
  staff_assistant: { phase: 10 },
  workflow_agent: { phase: 11 },
  campus_assistant: { phase: 12 },
  voice: { phase: 13 },
  integrations: { phase: 14 },
  whatsapp: { phase: 14 },
  custom_domain: { phase: 17 },
  sso: { phase: 16 },
} as const satisfies Record<string, { phase: number }>

export type FeatureKey = keyof typeof FEATURES

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(FEATURES, value)
}
