import { describe, expect, it } from 'vitest'
import { consentFor, pick, programToChunk, selectPrograms, tuitionText, type PublicAdmissions, type PublicProgram } from './public'
import { manualLeadSchema, programSchema, sanitizeLeadSearch, toProgramRow } from './schemas'

const program = (over: Partial<PublicProgram> = {}): PublicProgram => ({
  id: '11111111-1111-4111-8111-111111111111',
  code: 'CS-BSC',
  name: 'Computer Science',
  name_ar: 'علوم الحاسوب',
  level: 'bachelor',
  department: 'Engineering',
  department_ar: 'الهندسة',
  description: 'Software, algorithms and data.',
  description_ar: null,
  requirements: 'Secondary school certificate\nMathematics',
  requirements_ar: null,
  duration_months: 48,
  study_mode: 'full_time',
  teaching_language: 'en',
  intakes: 'September',
  intakes_ar: 'سبتمبر',
  tuition_amount: 1200,
  tuition_currency: 'USD',
  tuition_period: 'semester',
  tuition_note: null,
  tuition_note_ar: null,
  application_deadline: '2027-07-31',
  application_url: 'https://apply.example/cs',
  updated_at: '2026-11-24T00:00:00Z',
  ...over,
})

describe('program passages', () => {
  it('carry every published fact exactly as stored, in both languages', () => {
    const c = programToChunk(program(), 0)
    expect(c).toMatchObject({ chunk_id: -1, program_id: program().id, program_code: 'CS-BSC', title: 'Computer Science', title_ar: 'علوم الحاسوب' })
    for (const fact of ['Computer Science (code CS-BSC)', 'Arabic name: علوم الحاسوب', "Level: Bachelor's degree", 'Duration: 48 months', 'Tuition: 1200 USD per semester', 'Application deadline: 2027-07-31', 'Intakes (Arabic): سبتمبر', 'Secondary school certificate'])
      expect(c.content).toContain(fact)
  })

  it('leave out what is not set and never invent tuition', () => {
    const c = programToChunk(program({ tuition_amount: null, duration_months: null, application_url: null }), 3)
    expect(c.chunk_id).toBe(-4)
    expect(c.content).not.toMatch(/Tuition:|Duration:|How to apply/)
    expect(tuitionText({ tuition_amount: 100, tuition_currency: null, tuition_period: 'year' })).toBeNull()
  })

  it('keep all programs when there are few, otherwise the ones the question names', () => {
    const list = Array.from({ length: 12 }, (_, i) => program({ id: `id-${i}`, code: `P${i}`, name: `Program ${i}`, name_ar: null, description: null, department: null, department_ar: null }))
    list[9] = program({ id: 'nursing', code: 'NUR', name: 'Nursing', name_ar: 'التمريض', description: null, department: null, department_ar: null })
    expect(selectPrograms('anything', list.slice(0, 5))).toHaveLength(5)
    expect(selectPrograms('What does nursing cost?', list, 3)[0]!.id).toBe('nursing')
    expect(selectPrograms('كم رسوم التمريض؟', list, 3)[0]!.id).toBe('nursing')
    expect(selectPrograms('hello', list, 3).map((p) => p.id)).toEqual(['id-0', 'id-1', 'id-2'])
  })
})

describe('consent wording', () => {
  const page = (over: Partial<PublicAdmissions['settings']> = {}): PublicAdmissions => ({
    tenant: { slug: 'u', name: 'U', name_translations: {}, default_locale: 'en' },
    branding: {},
    settings: { assistant_enabled: false, contact_email: null, privacy_url: null, welcome: null, welcome_ar: null, consent_text: null, consent_text_ar: null, consent_version: 3, ...over },
    programs: [],
  })

  it('uses the platform default (versioned separately) until the university sets its own', () => {
    expect(consentFor(page(), 'en', 'DEFAULT')).toEqual({ text: 'DEFAULT', version: 'default-1' })
    expect(consentFor(page({ consent_text: 'Our own words for consent.' }), 'en', 'DEFAULT')).toEqual({ text: 'Our own words for consent.', version: '3' })
  })

  it('shows the Arabic wording to Arabic visitors when it exists', () => {
    const p = page({ consent_text: 'English wording here.', consent_text_ar: 'صياغة عربية للموافقة.' })
    expect(consentFor(p, 'ar', 'x').text).toBe('صياغة عربية للموافقة.')
    expect(consentFor(page({ consent_text: 'English wording here.' }), 'ar', 'x').text).toBe('English wording here.')
    expect(pick('ar', 'en', '  ')).toBe('en')
  })
})

describe('staff forms', () => {
  it('validates programs like the database does', () => {
    const ok = programSchema.safeParse({ code: 'CS-BSC', name: 'Computer Science', level: 'bachelor', tuitionAmount: '1200', tuitionCurrency: 'usd', tuitionPeriod: 'semester', applicationUrl: 'https://apply.example' })
    expect(ok.success).toBe(true)
    expect(toProgramRow(ok.data!)).toMatchObject({ tuition_amount: 1200, tuition_currency: 'USD', sort_order: 0, department_id: null })
    const errors = (input: Record<string, string>) => programSchema.safeParse({ code: 'OK', name: 'Valid name', level: 'bachelor', ...input }).error?.issues.map((i) => i.message)
    expect(errors({ code: 'bad code!' })).toContain('codeInvalid')
    expect(errors({ applicationUrl: 'http://insecure.example' })).toContain('urlInvalid')
    expect(errors({ applicationUrl: 'javascript:alert(1)' })).toContain('urlInvalid')
    expect(errors({ tuitionAmount: '100' })).toContain('tuitionIncomplete')
    expect(errors({ durationMonths: '4.5' })).toContain('numberInvalid')
    expect(errors({ level: 'phd' })).toContain('invalidValue')
  })

  it('requires a contact and a consent note for inquiries recorded by staff', () => {
    expect(manualLeadSchema.safeParse({ fullName: 'Omar Ali', consentNote: 'Agreed by phone today' }).error?.issues[0]?.message).toBe('contactRequired')
    expect(manualLeadSchema.safeParse({ fullName: 'Omar Ali', phone: '+249 900', consentNote: 'yes' }).error?.issues.map((i) => i.message)).toContain('consentNoteRequired')
    expect(manualLeadSchema.safeParse({ fullName: 'Omar Ali', phone: '+249 900 000', consentNote: 'Agreed by phone today' }).success).toBe(true)
  })

  it('cleans lead search text before it reaches a PostgREST filter', () => {
    expect(sanitizeLeadSearch('amal@example.com')).toBe('amal@example.com')
    // Separators of the PostgREST filter grammar and LIKE wildcards (% and _) are removed.
    expect(sanitizeLeadSearch('x,full_name.eq.y)')).toBe('x full name.eq.y')
    expect(sanitizeLeadSearch('%')).toBeNull()
    expect(sanitizeLeadSearch('أمل')).toBe('أمل')
  })
})
