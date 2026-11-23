import 'server-only'
import type { ProgramFormLabels } from '@/components/admissions/staff-forms'
import type { Dictionary } from '@/lib/i18n/get-dictionary'

/** Plain-string labels for the program form (shared by the create and edit pages). */
export function programFormLabels(dict: Dictionary, submit: string): ProgramFormLabels {
  const f = dict.admissions.programs.fields
  return {
    code: f.code,
    codeHint: f.codeHint,
    name: f.name,
    nameAr: f.nameAr,
    level: f.level,
    department: f.department,
    noDepartment: f.noDepartment,
    description: f.description,
    descriptionAr: f.descriptionAr,
    requirements: f.requirements,
    requirementsAr: f.requirementsAr,
    requirementsHint: f.requirementsHint,
    duration: f.duration,
    studyMode: f.studyMode,
    language: f.language,
    intakes: f.intakes,
    intakesAr: f.intakesAr,
    intakesHint: f.intakesHint,
    tuitionAmount: f.tuitionAmount,
    tuitionCurrency: f.tuitionCurrency,
    tuitionCurrencyHint: f.tuitionCurrencyHint,
    tuitionPeriod: f.tuitionPeriod,
    tuitionNote: f.tuitionNote,
    tuitionNoteAr: f.tuitionNoteAr,
    deadline: f.deadline,
    applicationUrl: f.applicationUrl,
    sortOrder: f.sortOrder,
    notSpecified: dict.admissions.notSpecified,
    optional: dict.common.optional,
    submit,
    saving: dict.management.saving,
  }
}
