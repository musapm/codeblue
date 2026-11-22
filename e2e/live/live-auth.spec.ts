import { expect, test, type Page } from '@playwright/test'

/**
 * LIVE end-to-end tests against a real Supabase project (not run by default).
 *
 * Runs only when these env vars are set (dedicated test accounts, never real users):
 *   LIVE_E2E=1
 *   LIVE_STUDENT_EMAIL / LIVE_STUDENT_PASSWORD   — student in the demo tenant "northbridge"
 *   LIVE_OWNER_EMAIL / LIVE_OWNER_PASSWORD       — university_owner in "northbridge"
 *   LIVE_OUTSIDER_EMAIL / LIVE_OUTSIDER_PASSWORD — signed-in user without any membership
 *   LIVE_OTHER_TENANT_SLUG                       — another tenant the above users do NOT belong to
 * and the app was built with NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY for that project.
 * This covers test T18 (HTTP-level isolation) from docs/tenant-isolation.md.
 */

const live = process.env.LIVE_E2E === '1'
test.skip(!live, 'Set LIVE_E2E=1 and the LIVE_* credentials to run live tests')
test.describe.configure({ mode: 'serial' })

const env = (name: string) => process.env[name] ?? ''

async function signIn(page: Page, email: string, password: string, locale = 'en') {
  await page.goto(`/${locale}/login`)
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
}

async function expectNotFound(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
}

test('student: lands in their university, sees only what their role allows', async ({ page }) => {
  await signIn(page, env('LIVE_STUDENT_EMAIL'), env('LIVE_STUDENT_PASSWORD'))
  await expect(page).toHaveURL(/\/en\/app\/northbridge$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Northbridge University workspace')
  await expect(page.getByRole('note')).toHaveCount(0) // no preview banner for real users

  const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
  await expect(nav.getByRole('link', { name: /Overview/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Settings/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Members/ })).toHaveCount(0)

  // Direct URL access is enforced server-side, not just hidden in the menu.
  await expectNotFound(page, '/en/app/northbridge/settings')
  await expectNotFound(page, '/en/app/northbridge/members')
  await expectNotFound(page, '/en/app/northbridge/audit')
})

test('student: cannot open another university or the platform console (T18)', async ({ page }) => {
  await signIn(page, env('LIVE_STUDENT_EMAIL'), env('LIVE_STUDENT_PASSWORD'))
  await expect(page).toHaveURL(/\/en\/app\/northbridge$/)
  await expectNotFound(page, `/en/app/${env('LIVE_OTHER_TENANT_SLUG')}`)
  await expectNotFound(page, '/en/app/does-not-exist') // identical to an existing foreign tenant
  await expectNotFound(page, '/en/platform')
})

test('sign out ends the session', async ({ page }) => {
  await signIn(page, env('LIVE_STUDENT_EMAIL'), env('LIVE_STUDENT_PASSWORD'))
  await expect(page).toHaveURL(/\/en\/app\/northbridge$/)
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/en\/login$/)
  const response = await page.request.get('/en/app/northbridge', { maxRedirects: 0 })
  expect(response.status()).toBe(307)
})

test('owner: settings and branding are available; Arabic shows the Arabic university name', async ({ page }) => {
  await signIn(page, env('LIVE_OWNER_EMAIL'), env('LIVE_OWNER_PASSWORD'))
  await expect(page).toHaveURL(/\/en\/app\/northbridge$/)
  await page.goto('/en/app/northbridge/settings')
  await expect(page.getByText('Northbridge University').first()).toBeVisible()
  await page.goto('/en/app/northbridge/settings/branding')
  await expect(page.getByRole('textbox', { name: 'Primary color', exact: true })).toHaveValue('#1b4f8f')
  await page.goto('/ar/app/northbridge')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('جامعة نورثبريدج')
})

test('owner of one university cannot reach another (T18)', async ({ page }) => {
  await signIn(page, env('LIVE_OWNER_EMAIL'), env('LIVE_OWNER_PASSWORD'))
  await expect(page).toHaveURL(/\/en\/app\/northbridge$/)
  await expectNotFound(page, `/en/app/${env('LIVE_OTHER_TENANT_SLUG')}/settings`)
})

test('signed-in user without a university gets the no-access page with sign-out', async ({ page }) => {
  await signIn(page, env('LIVE_OUTSIDER_EMAIL'), env('LIVE_OUTSIDER_PASSWORD'))
  await expect(page.getByRole('heading', { name: 'No university access yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/en\/login$/)
})
