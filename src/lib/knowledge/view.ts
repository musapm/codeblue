import 'server-only'
import type { MetaLabels } from '@/components/knowledge/meta-fields'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import type { DocumentState } from './queries'

export function metaLabels(dict: Dictionary): MetaLabels {
  const f = dict.management.knowledge.fields
  return {
    title: f.title,
    titleAr: f.titleAr,
    description: f.description,
    language: f.language,
    languages: f.languages,
    department: f.department,
    noDepartment: f.noDepartment,
    category: f.category,
    categoryHint: f.categoryHint,
    visibility: f.visibility,
    visibilities: f.visibilities,
    accessDepartments: f.accessDepartments,
    accessRoles: f.accessRoles,
    authoritative: f.authoritative,
    priority: f.priority,
    effectiveDate: f.effectiveDate,
    expiryDate: f.expiryDate,
    sourceUrl: f.sourceUrl,
    optional: dict.common.optional,
  }
}

export const STATE_VARIANT: Record<DocumentState, 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'outline'> = {
  uploading: 'info',
  queued: 'info',
  processing: 'info',
  ready: 'neutral',
  failed: 'danger',
  needs_ocr: 'warning',
  draft: 'neutral',
  published: 'success',
  archived: 'outline',
  expired: 'warning',
}

export function stateLabel(dict: Dictionary, state: DocumentState): string {
  const s = dict.management.knowledge.status
  return state === 'ready' ? s.draft : s[state]
}

export function formatBytes(n: number, locale: string): string {
  const units = ['B', 'KB', 'MB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)} ${units[i]}`
}
