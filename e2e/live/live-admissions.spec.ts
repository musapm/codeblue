import { expect, test, type Page } from '@playwright/test'

/**
 * LIVE Phase 6 test (admissions) against a real Supabase project (not run by default).
 *
 * WRITTEN BUT NOT YET RUN: it needs anonymous sign-ins enabled in Supabase Auth (ADR-025), and
 * CAPTCHA must be off for the run (or NEXT_PUBLIC_TURNSTILE_SITE_KEY set to Cloudflare's testing
 * key that always passes).
 *
 *   LIVE_E2E=1
 *   LIVE_ADMISSIONS_TENANT_SLUG                       — a university with the admissions_agent feature on
 *   LIVE_NEW_OWNER_EMAIL / LIVE_NEW_OWNER_PASSWORD    — an active owner of that university
 *
 * Flow: the owner publishes the admissions page and a program → a visitor (no account) sees it,
 * sends an inquiry with consent and gets a reference → the visitor's anonymous session cannot
 * open the workspace → the owner finds the inquiry, moves it, adds a note, exports it (if
 * migration 12 is applied) and deletes it → the program is deleted and the page unpublished.
 * Leaves one anonymous visitor account behind (removed by the cleanup job or by hand).
 */

const live = process.env.LIVE_E2E === '1' && Boolean(process.env.LIVE_ADMISSIONS_TENANT_SLUG)
test.skip(!live, 'Set LIVE_E2E=1, LIVE_ADMISSIONS_TENANT_SLUG and the LIVE_NEW_OWNER_* credentials to run')
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const env = (name: string) => process.env[name] ?? ''
const SLUG = env('LIVE_ADMISSIONS_TENANT_SLUG')
const staff = (path = '') => `/en/app/${SLUG}/admissions${path}`
const PROGRAM = { code: 'LIVE-T1', name: 'Live Test Program (delete me)' }
let reference = ''

async function signIn(page: Page) {
  await page.goto('/en/login')
  await page.locator('input[name="email"]').fill(env('LIVE_NEW_OWNER_EMAIL'))
  await page.locator('input[name="password"]').fill(env('LIVE_NEW_OWNER_PASSWORD'))
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.endsWith('/login'))
}

test('owner publishes the admissions page and a program', async ({ page }) => {
  await signIn(page)
  await page.goto(staff('/settings'))
  await page.getByLabel('Publish the admissions page').check()
  await page.getByLabel('Admissions contact email').fill('admissions-live-test@example.test')
  await page.getByRole('button', { name: 'Save page settings' }).click()
  await expect(page.getByText('Saved.').first()).toBeVisible()

  await page.goto(staff('/programs'))
  await page.getByLabel('Code').fill(PROGRAM.code)
  await page.getByLabel('Name (English)').fill(PROGRAM.name)
  await page.getByLabel('Tuition amount').fill('1000')
  await page.getByLabel('Currency').fill('USD')
  await page.getByLabel('Per').selectOption('semester')
  await page.getByRole('button', { name: 'Create program' }).click()
  await expect(page.getByRole('heading', { name: PROGRAM.name })).toBeVisible()
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible()
})

test('a visitor sees the program and sends an inquiry with consent', async ({ browser }) => {
  const visitor = await browser.newContext() // no account, no session
  const page = await visitor.newPage()
  await page.goto(`/en/admissions/${SLUG}`)
  await expect(page.getByRole('heading', { level: 3, name: PROGRAM.name })).toBeVisible()
  await page.getByRole('link', { name: 'View program' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PROGRAM.name)
  await page.getByRole('link', { name: 'Request information' }).click()

  await page.getByLabel('Full name').fill('Live Test Visitor')
  await page.getByLabel('Email').fill('live-visitor@example.test')
  await page.getByRole('button', { name: 'Send inquiry' }).click()
  await expect(page.getByText('Please confirm you agree to be contacted.')).toBeVisible() // consent is required
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Send inquiry' }).click()
  const success = page.getByRole('status').filter({ hasText: 'Your inquiry was sent' })
  await expect(success).toBeVisible({ timeout: 30_000 })
  reference = (await success.textContent())?.match(/L-\d{5,}/)?.[0] ?? ''
  expect(reference).toMatch(/^L-\d{5,}$/)

  // The anonymous visitor session is not an account: the workspace sends it to the login page.
  await page.goto(`/en/app/${SLUG}`)
  await expect(page).toHaveURL(/\/en\/login/)
  await visitor.close()
})

test('owner works the inquiry through the pipeline and erases it', async ({ page }) => {
  await signIn(page)
  await page.goto(staff(`?q=${reference}`))
  await page.getByRole('link', { name: reference }).click()
  await expect(page.getByText('Live Test Visitor')).toBeVisible()
  await expect(page.getByText(/I agree that .* may contact me/)).toBeVisible() // the consent wording is stored

  await page.getByLabel('Stage').selectOption('contacted')
  await page.getByRole('button', { name: 'Update' }).click()
  await expect(page.getByText(/Stage: New → Contacted/)).toBeVisible()
  await page.getByPlaceholder(/Calls, emails, next steps/).fill('Live test note')
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('Live test note')).toBeVisible()

  const exported = await page.request.get(`/api/admissions/${SLUG}/leads/${page.url().split('/').pop()}/export`)
  if (exported.status() === 503) test.info().annotations.push({ type: 'note', description: 'export: migration 12 not applied yet' })
  else expect((await exported.json()).inquiry.reference).toBe(reference)

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete inquiry' }).click()
  await page.waitForURL((url) => url.pathname.endsWith('/admissions'))
  await page.goto(staff(`?q=${reference}`))
  await expect(page.getByText('No inquiries match these filters.')).toBeVisible()
})

test('cleanup: program deleted, page unpublished', async ({ page }) => {
  await signIn(page)
  await page.goto(staff('/programs'))
  await page.getByRole('link', { name: new RegExp(PROGRAM.name) }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL((url) => url.pathname.endsWith('/admissions/programs'))
  await page.goto(staff('/settings'))
  await page.getByLabel('Publish the admissions page').uncheck()
  await page.getByRole('button', { name: 'Save page settings' }).click()
  await expect(page.getByText('Saved.').first()).toBeVisible()
})
