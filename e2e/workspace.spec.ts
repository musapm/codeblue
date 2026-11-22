import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { trackErrors } from './helpers'

/**
 * Runs with UNIAGENT_UI_PREVIEW=true and no Supabase (see playwright.config.ts), so the
 * workspace shows fictional demo tenants. Real tenant isolation tests are Phase 2.
 */
test.describe('workspace shell (UI preview mode)', () => {
  test('/app opens the first workspace', async ({ page }) => {
    await page.goto('/en/app')
    await expect(page).toHaveURL(/\/en\/app\/northbridge$/)
  })

  test('overview shows the preview banner, navigation and no fake metrics', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge')
    await expect(page.getByRole('note')).toContainText('UI preview mode')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Northbridge University workspace')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    await expect(nav.getByRole('link', { name: /Knowledge base/ })).toBeVisible()
    await expect(page.getByText('No sample numbers are shown.')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('planned modules are labelled honestly', async ({ page }) => {
    await page.goto('/en/app/northbridge/tickets')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tickets')
    await expect(page.getByText('Planned · Phase 7').first()).toBeVisible()
    await expect(page.getByText('Not built yet')).toBeVisible()
  })

  test('unknown modules and tenants show not found', async ({ page }) => {
    await page.goto('/en/app/northbridge/does-not-exist')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await page.goto('/en/app/no-such-university')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })

  test('workspace switcher changes tenant and theme', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    await page.getByRole('button', { name: 'Switch workspace' }).click()
    await page.getByRole('menuitem', { name: /Al-Noor Institute of Technology/ }).click()
    await expect(page).toHaveURL(/\/en\/app\/al-noor$/)
    // Next.js keeps the previous route mounted but hidden (<Activity>), so target the visible one.
    const primary = await page.getByRole('main').evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-primary').trim())
    expect(primary).toBe('#0f766e')
  })

  test('branding editor previews colors and checks contrast', async ({ page }) => {
    await page.goto('/en/app/northbridge/settings/branding')
    await expect(page.getByText('All color combinations meet contrast guidelines.')).toBeVisible()
    const primaryInput = page.getByRole('textbox', { name: 'Primary color', exact: true })
    await primaryInput.fill('#ffeb3b')
    await expect(page.getByText(/Primary on white: contrast/)).toBeVisible()
    await primaryInput.fill('not-a-color')
    await expect(page.getByText('Use a hex color such as #1b4f8f.')).toBeVisible()
    await page.getByRole('button', { name: 'Reset to saved' }).click()
    await expect(page.getByText('All color combinations meet contrast guidelines.')).toBeVisible()
  })

  test('sign out from the user menu works (regression: form was detached)', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/en\/login$/)
  })

  test('Arabic workspace is right-to-left', async ({ page }) => {
    await page.goto('/ar/app/northbridge')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('مساحة عمل')
  })

  test('platform console shows environment readiness without secrets', async ({ page }) => {
    await page.goto('/en/platform')
    await expect(page.getByRole('heading', { name: 'Environment readiness' })).toBeVisible()
    await expect(page.getByText('Supabase (database & authentication)')).toBeVisible()
    await expect(page.getByText('Not configured').first()).toBeVisible()
  })

  test('workspace overview has no serious accessibility violations', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
  })
})

test.describe('workspace on mobile @mobile', () => {
  test('sidebar is available from the menu button', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('link', { name: /Settings/ }).click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/settings$/)
  })
})
