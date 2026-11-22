import { describe, expect, it } from 'vitest'
import { mapDbError } from './action-state'
import {
  brandingSchema,
  createTenantSchema,
  departmentSchema,
  inviteSchema,
  isValidTimeZone,
  profileSchema,
  sniffImageType,
  supportGrantSchema,
  toBrandingJson,
} from './schemas'

describe('mapDbError', () => {
  it('maps database error codes to user-facing keys', () => {
    expect(mapDbError({ code: '42501', message: 'not authorized' })).toBe('forbidden')
    expect(mapDbError({ code: '42501', message: 'only university owners can change ownership' })).toBe('ownerOnly')
    expect(mapDbError({ code: '23514', message: 'a university must keep at least one active owner' })).toBe('lastOwner')
    expect(mapDbError({ code: '23514', message: 'violates check constraint' })).toBe('invalid')
    expect(mapDbError({ code: '23505' })).toBe('conflict')
    expect(mapDbError({ code: '22023' })).toBe('invalid')
    expect(mapDbError({ code: 'P0002' })).toBe('notFound')
    expect(mapDbError({ message: 'new row violates row-level security policy' })).toBe('forbidden')
    expect(mapDbError({ code: 'XX000', message: 'boom' })).toBe('generic')
  })
})

describe('form schemas', () => {
  it('normalizes invitation input and bounds validity', () => {
    expect(inviteSchema.parse({ email: '  New.Person@Example.COM ', roleKey: 'student', validDays: '14' })).toEqual({
      email: 'new.person@example.com',
      roleKey: 'student',
      validDays: 14,
    })
    expect(inviteSchema.safeParse({ email: 'x@example.com', roleKey: 'student', validDays: '31' }).success).toBe(false)
    expect(inviteSchema.safeParse({ email: 'x@example.com', roleKey: 'Robert); drop table', validDays: '7' }).success).toBe(false)
    expect(inviteSchema.parse({ email: 'x@example.com', roleKey: 'student' }).validDays).toBe(7)
  })

  it('validates department slugs like the database constraint', () => {
    const ok = departmentSchema.parse({ name: 'Admissions', slug: 'Admissions-Office', email: '' })
    expect(ok).toMatchObject({ slug: 'admissions-office', email: undefined })
    expect(ok.nameAr).toBeUndefined()
    for (const slug of ['-bad', 'bad-', 'a'.repeat(49), 'has space', 'ümlaut']) {
      expect(departmentSchema.safeParse({ name: 'Admissions', slug }).success, slug).toBe(false)
    }
    expect(departmentSchema.safeParse({ name: 'A', slug: 'ok' }).success).toBe(false)
  })

  it('accepts only real time zones', () => {
    expect(isValidTimeZone('Africa/Khartoum')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false)
    expect(profileSchema.safeParse({ defaultLocale: 'ar', timezone: 'Asia/Riyadh' }).success).toBe(true)
    expect(profileSchema.safeParse({ defaultLocale: 'fr', timezone: 'UTC' }).success).toBe(false)
  })

  it('branding accepts hex colors only and maps to the stored JSON', () => {
    const parsed = brandingSchema.parse({ primary: '#1B4F8F', secondary: '#0f2a4a', accent: '#d97706', assistantName: ' Nova ', monogram: 'nb' })
    expect(toBrandingJson(parsed, 'a'.repeat(8) + '-0000-4000-8000-000000000000/logo.png')).toEqual({
      primary: '#1b4f8f',
      secondary: '#0f2a4a',
      accent: '#d97706',
      assistant_name: 'Nova',
      monogram: 'NB',
      logo_path: 'aaaaaaaa-0000-4000-8000-000000000000/logo.png',
    })
    for (const bad of ['red', 'url(javascript:alert(1))', '#12345', '#1234567', 'expression(alert(1))']) {
      expect(brandingSchema.safeParse({ primary: bad, secondary: '#000000', accent: '#000000' }).success, bad).toBe(false)
    }
  })

  it('tenant creation and support grants follow the database limits', () => {
    expect(createTenantSchema.parse({ name: 'Uni', slug: 'uni', defaultLocale: 'en', timezone: 'UTC', isDemo: 'on' }).isDemo).toBe(true)
    expect(createTenantSchema.parse({ name: 'Uni', slug: 'uni', defaultLocale: 'en', timezone: 'UTC' }).isDemo).toBe(false)
    const grant = { slug: 'uni', granteeId: '00000000-0000-4000-8000-000000000001', reason: 'Ticket 12: branding page', hours: '24' }
    expect(supportGrantSchema.parse(grant).hours).toBe(24)
    expect(supportGrantSchema.safeParse({ ...grant, hours: '25' }).success).toBe(false)
    expect(supportGrantSchema.safeParse({ ...grant, reason: 'short' }).success).toBe(false)
  })
})

describe('sniffImageType', () => {
  it('recognizes PNG, JPEG and WebP by their signatures', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
  })

  it('rejects SVG, HTML and renamed files', () => {
    const enc = new TextEncoder()
    expect(sniffImageType(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull()
    expect(sniffImageType(enc.encode('<!doctype html><script>alert(1)</script>'))).toBeNull()
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20]))).toBeNull()
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
  })
})
