import { describe, expect, it } from 'vitest'
import robots from './robots'
import sitemap from './sitemap'

describe('robots.txt and sitemap', () => {
  it('keeps workspaces, the console, auth pages and APIs out of search engines', () => {
    const r = robots()
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules
    expect(rule.disallow).toEqual(expect.arrayContaining(['/api/', '/auth/', '/en/app', '/ar/app', '/en/platform', '/ar/platform', '/en/login']))
    expect(String(rule.disallow)).not.toContain('/admissions')
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/)
  })

  it('lists every marketing page in both languages with alternates', () => {
    const entries = sitemap()
    expect(entries.length).toBe(20)
    const home = entries.find((e) => e.url.endsWith('/en'))!
    expect(home.alternates?.languages).toMatchObject({ en: expect.stringMatching(/\/en$/), ar: expect.stringMatching(/\/ar$/) })
    expect(entries.some((e) => e.url.includes('/app'))).toBe(false)
  })
})
