import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { MARKETING_PATHS, trackErrors } from './helpers'

test.describe('public website', () => {
  for (const locale of ['en', 'ar'] as const) {
    for (const path of MARKETING_PATHS) {
      test(`${locale}${path || '/'} renders without errors`, async ({ page }) => {
        const errors = trackErrors(page)
        const response = await page.goto(`/${locale}${path}`)
        expect(response?.status()).toBe(200)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expect(page.locator('h1').first()).toBeVisible()
        await expect(page.locator('footer')).toBeVisible()
        expect(errors).toEqual([])
      })
    }
  }

  test('un-prefixed URLs redirect by Accept-Language', async ({ browser }) => {
    // Chromium derives Accept-Language from the context locale.
    const arabic = await browser.newContext({ locale: 'ar-SD' })
    const page = await arabic.newPage()
    await page.goto('/pricing')
    await expect(page).toHaveURL(/\/ar\/pricing$/)
    await arabic.close()
  })

  test('language switcher keeps the current page and remembers the choice', async ({ page, context }) => {
    await page.goto('/en/features')
    await page.getByRole('banner').getByRole('link', { name: /العربية/ }).first().click()
    await expect(page).toHaveURL(/\/ar\/features$/)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    const cookies = await context.cookies()
    expect(cookies.find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('ar')
  })

  test('roadmap capabilities are labelled as in development', async ({ page }) => {
    await page.goto('/en')
    await expect(page.getByRole('note').first()).toContainText('in active development')
    await expect(page.getByText('In development').first()).toBeVisible()
    await page.goto('/ar/features')
    await expect(page.getByText('قيد التطوير').first()).toBeVisible()
  })

  test('pricing shows plans without hardcoded prices', async ({ page }) => {
    await page.goto('/en/pricing')
    await expect(page.getByRole('heading', { name: 'Starter' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Professional' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Enterprise' })).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/\$\s?\d/)
  })

  test('white-label demo switches university themes', async ({ page }) => {
    await page.goto('/en/demo')
    const preview = page.locator('figure').first()
    await expect(preview).toContainText('Northbridge Assistant')
    await page.getByText('Al-Noor Institute of Technology').click()
    await expect(preview).toContainText('Noor Digital Campus')
    const primary = await preview.evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-primary').trim())
    expect(primary).toBe('#0f766e')
  })

  test('contact form validates and is honest that it does not store data yet', async ({ page }) => {
    await page.goto('/en/contact')
    await page.getByRole('button', { name: 'Send inquiry' }).click()
    await expect(page.getByText('Enter your name.')).toBeVisible()
    await expect(page.getByText('Please confirm you agree to be contacted.')).toBeVisible()

    await page.getByLabel('Full name').fill('Test Person')
    await page.getByLabel('Work email').fill('test@university.example')
    await page.getByLabel('University or organization').fill('Example University')
    await page.getByLabel('How can we help?').fill('We would like to see the admissions assistant in a demo.')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Send inquiry' }).click()
    await expect(page.getByText('Online inquiries are not active yet')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open in your email app' })).toHaveAttribute('href', /^mailto:/)
  })

  test('unknown pages return 404', async ({ page }) => {
    const response = await page.goto('/en/this-page-does-not-exist')
    expect(response?.status()).toBe(404)
  })

  test('security headers are present', async ({ request }) => {
    const response = await request.get('/en')
    const headers = response.headers()
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['x-powered-by']).toBeUndefined()
  })

  for (const path of ['/en', '/ar', '/en/pricing', '/en/contact']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('mobile navigation @mobile', () => {
  test('menu opens, navigates and closes', async ({ page }) => {
    await page.goto('/en')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('link', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/en\/pricing$/)
    await expect(dialog).toBeHidden()
  })

  test('no horizontal overflow on key pages', async ({ page }) => {
    for (const path of ['/en', '/ar', '/en/pricing', '/ar/login', '/en/app/northbridge']) {
      await page.goto(path)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, path).toBeLessThanOrEqual(1)
    }
  })
})

test.describe('search engines', () => {
  test('robots.txt keeps private areas out and points to the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()
    for (const path of ['/api/', '/en/app', '/ar/platform', '/en/login']) expect(body).toContain(`Disallow: ${path}`)
    expect(body).toMatch(/Sitemap: .*\/sitemap\.xml/)
  })

  test('sitemap.xml lists the public pages in both languages', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('/en/pricing</loc>')
    expect(body).toContain('/ar/pricing</loc>')
    expect(body).not.toContain('/app')
  })
})
