import { expect, test, type Page } from '@playwright/test'

/**
 * LIVE Phase 3 end-to-end test against a real Supabase project (not run by default).
 *
 * Walks the whole onboarding path through the real UI and database:
 *   platform admin creates a university and invites its owner → owner accepts, invites a
 *   student, creates a department, edits settings, publishes branding with a logo, reads
 *   the audit log → the wrong account cannot use the student's link → the student accepts
 *   and sees only student pages → the owner suspends the student → support access is
 *   granted, used read-only and revoked → the platform suspends the university.
 *
 * Env (dedicated temporary accounts only, never real users):
 *   LIVE_E2E=1
 *   LIVE_PLATFORM_EMAIL / LIVE_PLATFORM_PASSWORD   — platform admin (platform_admins.role = admin)
 *   LIVE_NEW_OWNER_EMAIL / LIVE_NEW_OWNER_PASSWORD — account without memberships (becomes owner)
 *   LIVE_NEW_STUDENT_EMAIL / LIVE_NEW_STUDENT_PASSWORD — account without memberships
 *   LIVE_OUTSIDER_EMAIL / LIVE_OUTSIDER_PASSWORD   — account without memberships
 *   LIVE_NEW_TENANT_SLUG                           — slug to create (must not exist yet)
 * The app must be built for that project and served with NEXT_PUBLIC_SITE_URL = baseURL.
 */

const live = process.env.LIVE_E2E === '1' && Boolean(process.env.LIVE_PLATFORM_EMAIL)
test.skip(!live, 'Set LIVE_E2E=1 and the LIVE_* management credentials to run')
test.describe.configure({ mode: 'serial' })

const env = (name: string) => process.env[name] ?? ''
const SLUG = env('LIVE_NEW_TENANT_SLUG')
const ws = (path = '') => `/en/app/${SLUG}${path}`

// 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

let ownerInvite = ''
let studentInvite = ''

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/en/login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.endsWith('/login'))
}

function acceptDialogs(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept())
}

test('platform admin creates a university and gets a one-time owner invitation', async ({ page }) => {
  await signIn(page, env('LIVE_PLATFORM_EMAIL'), env('LIVE_PLATFORM_PASSWORD'))
  await page.goto('/en/platform/tenants')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Universities')

  await page.locator('input[name="name"]').fill('E2E Live University')
  await page.locator('input[name="nameAr"]').fill('جامعة الاختبار الحي')
  await page.locator('input[name="slug"]').fill(SLUG)
  await page.locator('input[name="timezone"]').fill('Africa/Khartoum')
  await page.locator('input[name="ownerEmail"]').fill(env('LIVE_NEW_OWNER_EMAIL'))
  await page.getByRole('button', { name: 'Create university' }).click()

  await expect(page.getByText(`University “${SLUG}” created.`)).toBeVisible()
  ownerInvite = await page.getByLabel('Invitation link').inputValue()
  expect(ownerInvite).toMatch(new RegExp(`/en/invite/[0-9a-f]{64}$`))
  await expect(page.getByRole('cell', { name: /E2E Live University/ })).toBeVisible()

  // Duplicate slugs are refused with a field message, not a crash.
  await page.locator('input[name="name"]').fill('Duplicate')
  await page.locator('input[name="slug"]').fill(SLUG)
  await page.getByRole('button', { name: 'Create university' }).click()
  await expect(page.getByText('This address is already in use.')).toBeVisible()
})

test('platform admin toggles a feature on the university', async ({ page }) => {
  await signIn(page, env('LIVE_PLATFORM_EMAIL'), env('LIVE_PLATFORM_PASSWORD'))
  await page.goto(`/en/platform/tenants/${SLUG}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Live University')
  const toggle = page.getByRole('button', { name: /Turn (on|off) knowledge_base/ })
  const before = await toggle.getAttribute('aria-label')
  await toggle.click()
  await expect(page.getByRole('button', { name: before!.includes('on ') ? 'Turn off knowledge_base' : 'Turn on knowledge_base' })).toBeVisible()
})

test('owner accepts the invitation after signing in', async ({ page }) => {
  await page.goto(ownerInvite.replace(/^https?:\/\/[^/]+/, ''))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You have been invited')
  await page.getByRole('link', { name: 'Sign in' }).click()
  await page.locator('input[name="email"]').fill(env('LIVE_NEW_OWNER_EMAIL'))
  await page.locator('input[name="password"]').fill(env('LIVE_NEW_OWNER_PASSWORD'))
  await page.locator('form button[type="submit"]').click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Join E2E Live University')
  await expect(page.getByText('You have been invited with the role “University owner”.')).toBeVisible()
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(new RegExp(`${ws()}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Live University workspace')

  // The link is single-use.
  await page.goto(ownerInvite.replace(/^https?:\/\/[^/]+/, ''))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This invitation was already used')
})

test('owner invites a student, creates a department, edits settings and publishes branding', async ({ page }) => {
  acceptDialogs(page)
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))

  await page.goto(ws('/members'))
  await page.locator('input[name="email"]').fill(env('LIVE_NEW_STUDENT_EMAIL'))
  await page.getByLabel('Role', { exact: true }).selectOption('student')
  await page.getByRole('button', { name: 'Create invitation' }).click()
  studentInvite = await page.getByLabel('Invitation link').inputValue()
  expect(studentInvite).toMatch(/\/en\/invite\/[0-9a-f]{64}$/)
  await expect(page.getByRole('listitem').filter({ hasText: env('LIVE_NEW_STUDENT_EMAIL') }).first()).toBeVisible()

  await page.goto(ws('/departments'))
  await page.locator('input[name="name"]').fill('Admissions')
  await page.locator('input[name="nameAr"]').fill('القبول')
  await page.locator('input[name="slug"]').fill('admissions')
  await page.getByRole('button', { name: 'Create department' }).click()
  await expect(page.getByText('admissions', { exact: true })).toBeVisible()

  await page.goto(ws('/settings'))
  await page.locator('input[name="supportEmail"]').fill('help@uniagent.test')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.goto(ws('/settings/branding'))
  await page.getByRole('textbox', { name: 'Primary color', exact: true }).fill('#0f766e')
  await page.locator('input[name="assistantName"]').fill('Live Helper')
  await page.getByRole('button', { name: 'Save and publish' }).click()
  await expect(page.getByText(/^Published /)).toBeVisible()

  await page.locator('input[name="logo"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  await page.getByRole('button', { name: 'Upload logo' }).click()
  await expect(page.getByRole('img', { name: 'Current logo' })).toBeVisible()
  // A renamed non-image is refused by signature, not by file name.
  await page.locator('input[name="logo"]').setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"></svg>') })
  await page.getByRole('button', { name: 'Upload logo' }).click()
  await expect(page.getByText('Use a PNG, JPEG or WebP image.')).toBeVisible()
  await page.getByRole('button', { name: 'Save and publish' }).click()
  await expect(page.getByText(/^Published /)).toBeVisible()

  // The published theme reaches the workspace shell.
  await page.goto(ws())
  const primary = await page.getByRole('main').evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-primary').trim())
  expect(primary).toBe('#0f766e')

  await page.goto(ws('/audit'))
  await expect(page.getByRole('cell', { name: 'Invitation created' }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Department created' })).toBeVisible()
})

test('another account cannot use the student invitation', async ({ page }) => {
  await signIn(page, env('LIVE_OUTSIDER_EMAIL'), env('LIVE_OUTSIDER_PASSWORD'))
  await page.goto(studentInvite.replace(/^https?:\/\/[^/]+/, ''))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This invitation is for a different email address')
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0)
})

test('student accepts and only sees student pages', async ({ page }) => {
  await signIn(page, env('LIVE_NEW_STUDENT_EMAIL'), env('LIVE_NEW_STUDENT_PASSWORD'))
  await page.goto(studentInvite.replace(/^https?:\/\/[^/]+/, ''))
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(new RegExp(`${ws()}$`))
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
  await expect(nav.getByRole('link', { name: /Members/ })).toHaveCount(0)
  for (const path of ['/members', '/departments', '/audit', '/settings/branding']) {
    await page.goto(ws(path))
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  }
})

test('owner suspends the student, who then loses access', async ({ page, browser }) => {
  acceptDialogs(page)
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await page.goto(ws('/members'))
  const row = page.getByRole('listitem').filter({ hasText: env('LIVE_NEW_STUDENT_EMAIL') }).filter({ has: page.getByText('Manage') })
  await row.getByText('Manage').click()
  await row.getByRole('button', { name: 'Suspend' }).click()
  await expect(row.getByText('Suspended')).toBeVisible()

  const student = await browser.newPage()
  await signIn(student, env('LIVE_NEW_STUDENT_EMAIL'), env('LIVE_NEW_STUDENT_PASSWORD'))
  await student.goto(ws())
  await expect(student.getByRole('heading', { name: /Page not found|No university access yet/ })).toBeVisible()
  await student.close()
})

test('support access is granted, read-only, visible in the audit log, and revoked', async ({ page }) => {
  await signIn(page, env('LIVE_PLATFORM_EMAIL'), env('LIVE_PLATFORM_PASSWORD'))
  // Without a grant, platform staff cannot open the workspace (ADR-014).
  await page.goto(ws())
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await page.goto(`/en/platform/tenants/${SLUG}`)
  await page.locator('textarea[name="reason"]').fill('E2E: verify read-only support access')
  await page.getByRole('button', { name: 'Grant access' }).click()
  await expect(page.getByText('Active', { exact: true })).toBeVisible()

  await page.goto(ws())
  await expect(page.getByRole('note')).toContainText('Support access')
  await page.goto(ws('/members'))
  await expect(page.getByText('Support access is read-only: changes are disabled.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create invitation' })).toHaveCount(0)

  await page.goto(`/en/platform/tenants/${SLUG}`)
  await page.getByRole('button', { name: 'Revoke', exact: true }).last().click()
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible()
  await page.goto(ws())
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await page.goto('/en/platform/audit')
  await expect(page.getByRole('cell', { name: 'Support access granted' }).first()).toBeVisible()
})

test('platform suspends the university; members see the unavailable screen', async ({ page, browser }) => {
  acceptDialogs(page)
  await signIn(page, env('LIVE_PLATFORM_EMAIL'), env('LIVE_PLATFORM_PASSWORD'))
  await page.goto(`/en/platform/tenants/${SLUG}`)
  await page.getByLabel('Lifecycle status').selectOption('suspended')
  await page.getByRole('button', { name: 'Update status' }).click()
  await expect(page.getByText('Suspended').first()).toBeVisible()

  const owner = await browser.newPage()
  await signIn(owner, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await owner.goto(ws())
  await expect(owner.getByRole('heading', { name: 'This workspace is unavailable' })).toBeVisible()
  await owner.close()
})
