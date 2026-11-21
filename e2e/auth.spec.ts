import { expect, test } from '@playwright/test'
import { AUTH_PATHS, trackErrors } from './helpers'

/**
 * The e2e environment has no Supabase project, so these tests verify that auth pages
 * render correctly and are honest about being disabled. Live sign-in tests arrive with
 * Phase 2 (see docs/testing.md).
 */
test.describe('authentication pages (no backend configured)', () => {
  for (const locale of ['en', 'ar'] as const) {
    for (const path of AUTH_PATHS) {
      test(`${locale}${path} renders the not-configured state`, async ({ page }) => {
        const errors = trackErrors(page)
        const response = await page.goto(`/${locale}${path}`)
        expect(response?.status()).toBe(200)
        await expect(page.locator('h1')).toBeVisible()
        await expect(page.getByText(locale === 'en' ? 'Authentication is not configured' : 'المصادقة غير مهيأة')).toBeVisible()
        // Inputs inherit `disabled` from the fieldset, so nothing can reach a missing backend.
        const inputs = page.locator('form input:not([type="hidden"])')
        expect(await inputs.count()).toBeGreaterThan(0)
        for (const input of await inputs.all()) await expect(input).toBeDisabled()
        await expect(page.locator('form button[type="submit"]')).toBeDisabled()
        expect(errors).toEqual([])
      })
    }
  }

  test('login links to registration and password reset', async ({ page }) => {
    await page.goto('/en/login')
    await expect(page.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/en/forgot-password')
    await expect(page.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/en/register')
  })

  test('password visibility toggle is labelled', async ({ page }) => {
    await page.goto('/en/login')
    await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible()
  })

  test('open redirects in ?next= are discarded', async ({ page }) => {
    await page.goto('/en/login?next=//evil.example/steal')
    await expect(page.locator('input[name="next"]')).toHaveCount(0)
    await page.goto('/en/login?next=/en/app/northbridge')
    await expect(page.locator('input[name="next"]')).toHaveValue('/en/app/northbridge')
  })

  test('invalid callback links show an error on the login page', async ({ page }) => {
    await page.goto('/en/login?error=link')
    await expect(page.getByText('This link is invalid or has expired.')).toBeVisible()
  })

  test('auth callback without a code does not create a session', async ({ request }) => {
    const response = await request.get('/auth/callback?next=https://evil.example', { maxRedirects: 0 })
    expect(response.status()).toBe(303)
    const location = response.headers()['location'] ?? ''
    expect(location).toContain('/en/login?error=link')
    expect(location).not.toContain('evil.example')
  })
})
