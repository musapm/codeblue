import type { Dictionary } from '@/lib/i18n/dictionaries/en'
import type { FormLabels } from '@/components/workflows/request-form'
import type { BuilderLabels } from '@/components/workflows/form-builder'
import type { RequestStatus } from './schemas'

/** Presentation helpers for the workflow pages (plain data only). */

export const STATUS_VARIANT: Record<RequestStatus, 'info' | 'primary' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  submitted: 'info',
  in_review: 'primary',
  needs_info: 'warning',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
  cancelled: 'neutral',
}

export const formTitle = (locale: string, d: { title: string; title_ar: string | null }) => (locale === 'ar' && d.title_ar) || d.title

export function formLabels(dict: Dictionary): FormLabels {
  const f = dict.workflows.form
  return {
    review: f.review,
    edit: f.edit,
    confirmTitle: f.confirmTitle,
    confirmHint: f.confirmHint,
    defaultConfirmation: f.defaultConfirmation,
    submit: f.submit,
    submitting: f.submitting,
    required: f.required,
    invalid: f.invalid,
    fixErrors: f.fixErrors,
    choose: f.choose,
    prefilled: f.prefilled,
    notAnswered: f.notAnswered,
    optional: dict.common.optional,
    yes: dict.workflows.yes,
    no: dict.workflows.no,
    aiLabel: dict.workflows.services.suggest.aiLabel,
  }
}

export function builderLabels(dict: Dictionary): BuilderLabels {
  const f = dict.workflows.forms
  return {
    fields: f.fields,
    addField: f.addField,
    field: f.field(-1).replace('-1', '{n}'),
    fieldLabel: f.fieldLabel,
    fieldLabelAr: f.fieldLabelAr,
    fieldHelp: f.fieldHelp,
    fieldHelpAr: f.fieldHelpAr,
    fieldType: f.fieldType,
    fieldRequired: f.fieldRequired,
    fieldOptions: f.fieldOptions,
    fieldOptionsHint: f.fieldOptionsHint,
    moveUp: f.moveUp,
    moveDown: f.moveDown,
    removeField: f.removeField,
    instructions: f.instructions,
    instructionsAr: f.instructionsAr,
    confirmation: f.confirmation,
    confirmationHint: f.confirmationHint,
    confirmationAr: f.confirmationAr,
    saveDraft: f.saveDraft,
    saving: dict.management.saving,
    optional: dict.common.optional,
    types: dict.workflows.fieldTypes,
  }
}
