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
    await page.goto('/en/app/northbridge/workflows')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Requests & workflows')
    await expect(page.getByText('Planned · Phase 11').first()).toBeVisible()
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

test.describe('university management pages (UI preview mode, read-only)', () => {
  for (const [path, heading] of [
    ['/en/app/northbridge/members', 'Members & roles'],
    ['/en/app/northbridge/departments', 'Departments'],
    ['/en/app/northbridge/audit', 'Audit log'],
    ['/en/platform/tenants', 'Universities'],
    ['/en/platform/audit', 'Platform audit log'],
  ] as const) {
    test(`${path} renders honestly without data`, async ({ page }) => {
      const errors = trackErrors(page)
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
      // Preview never pretends to have data or to save anything.
      await expect(page.getByRole('button', { name: /Create invitation|Create department|Create university/ })).toHaveCount(0)
      expect(errors).toEqual([])
    })
  }

  test('members page shows the read-only preview notice and role catalog', async ({ page }) => {
    await page.goto('/en/app/northbridge/members')
    await expect(page.getByText('Preview mode: the lists are empty and nothing can be saved.')).toBeVisible()
    await expect(page.getByText('No members yet.')).toBeVisible()
  })

  test('branding page cannot save in preview mode', async ({ page }) => {
    await page.goto('/en/app/northbridge/settings/branding')
    await expect(page.getByText('Preview mode: the lists are empty and nothing can be saved.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save and publish' })).toHaveCount(0)
  })

  test('navigation marks Phase 3 modules as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    await nav.getByRole('link', { name: /Members & roles/ }).click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/members$/)
  })

  test('invitation page asks to sign in and does not leak the URL', async ({ page }) => {
    const token = 'a'.repeat(64)
    const response = await page.goto(`/en/invite/${token}`)
    expect(response?.status()).toBeLessThan(500)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('You have been invited')
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  test('Arabic members page is translated and right-to-left', async ({ page }) => {
    await page.goto('/ar/app/northbridge/members')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الأعضاء والأدوار')
  })

  for (const path of ['/en/app/northbridge/members', '/en/app/northbridge/settings/branding', '/en/platform/tenants', '/ar/app/northbridge/departments']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('knowledge base (UI preview mode, read-only)', () => {
  test('page renders without data and offers no upload', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/knowledge')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Knowledge base')
    await expect(page.getByText('Preview mode: no documents can be uploaded.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload and process' })).toHaveCount(0)
    await expect(page.getByRole('search')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('Arabic knowledge page is translated', async ({ page }) => {
    await page.goto('/ar/app/northbridge/knowledge')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('قاعدة المعرفة')
  })

  test('unknown document ids are not found', async ({ page }) => {
    await page.goto('/en/app/northbridge/knowledge/00000000-0000-4000-8000-000000000000')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })

  test('knowledge page has no serious accessibility violations', async ({ page }) => {
    await page.goto('/en/app/northbridge/knowledge')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
  })
})

test.describe('student assistant (UI preview mode)', () => {
  test('chat page renders, explains why it cannot answer and keeps the composer disabled', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/ask')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Ask /)
    const composer = page.getByRole('textbox', { name: 'Ask a question about the university…' })
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', 'UI preview mode: the assistant does not run without a backend.')
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
    await expect(page.getByText('No conversations yet.')).toBeVisible()
    await expect(page.getByText(/AI answers can contain mistakes/)).toBeVisible()
    expect(errors).toEqual([])
  })

  test('navigation offers the chat and the assistant settings', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    await expect(nav.getByRole('link', { name: /Ask the assistant/ })).toBeVisible()
    await nav.getByRole('link', { name: /Student assistant/ }).click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/assistant$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Student assistant')
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)
  })

  test('Arabic chat page is translated and right-to-left', async ({ page }) => {
    await page.goto('/ar/app/northbridge/ask')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^اسأل /)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  })

  test('the answer endpoint refuses cross-site requests and does nothing in preview mode', async ({ request, baseURL }) => {
    const body = { question: 'How much is tuition?', locale: 'en' }
    const crossSite = await request.post('/api/assistant/northbridge', { data: body, headers: { Origin: 'https://evil.example' } })
    expect(crossSite.status()).toBe(403)
    const preview = await request.post('/api/assistant/northbridge', { data: body, headers: { Origin: new URL(baseURL!).origin } })
    expect(preview.status()).toBe(503)
    expect(await preview.json()).toEqual({ error: 'preview' })
  })

  for (const path of ['/en/app/northbridge/ask', '/en/app/northbridge/assistant']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('admissions (UI preview mode)', () => {
  test('staff pages render honestly without data and offer no writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/admissions')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admissions')
    await expect(page.getByText(/No inquiries yet/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save inquiry' })).toHaveCount(0)
    const tabs = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Inquiries' }) })
    for (const name of ['Inquiries', 'Programs', 'Analytics', 'Settings']) await expect(tabs.getByRole('link', { name })).toBeVisible()
    await tabs.getByRole('link', { name: 'Programs' }).click()
    await expect(page.getByText(/No programs yet/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create program' })).toHaveCount(0)
    await page.goto('/en/app/northbridge/admissions/analytics')
    await expect(page.getByText(/nothing here is estimated or sample data/)).toBeVisible()
    await page.goto('/en/app/northbridge/admissions/settings')
    await expect(page.getByText(/Anonymous sign-ins must be enabled/)).toBeVisible()
    expect(errors).toEqual([])
  })

  test('navigation lists admissions as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    const link = nav.getByRole('link', { name: /Admissions/ })
    await expect(link).toBeVisible()
    await expect(link).not.toContainText('P6')
  })

  test('Arabic admissions page is translated', async ({ page }) => {
    await page.goto('/ar/app/northbridge/admissions')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('القبول')
  })

  test('the public page of a university without a backend is not found; unknown ids too', async ({ page }) => {
    await page.goto('/en/admissions/northbridge')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await page.goto('/en/app/northbridge/admissions/leads/00000000-0000-4000-8000-000000000000')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })

  test('the admissions endpoint refuses cross-site requests and needs a backend', async ({ request, baseURL }) => {
    const body = { question: 'Which programs do you offer?', locale: 'en' }
    expect((await request.post('/api/admissions/northbridge', { data: body, headers: { Origin: 'https://evil.example' } })).status()).toBe(403)
    const preview = await request.post('/api/admissions/northbridge', { data: body, headers: { Origin: new URL(baseURL!).origin } })
    expect(preview.status()).toBe(503)
    expect(await preview.json()).toEqual({ error: 'notConfigured' })
  })

  for (const path of ['/en/app/northbridge/admissions', '/en/app/northbridge/admissions/programs', '/ar/app/northbridge/admissions/settings']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('tickets and requests (UI preview mode)', () => {
  test('staff queue, requests, categories and notifications render honestly without data and offer no writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/tickets')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tickets')
    const queues = page.getByRole('navigation', { name: 'Tickets' })
    for (const name of ['Assigned to me', 'My departments', 'Unassigned', 'All']) await expect(queues.getByRole('link', { name })).toBeVisible()
    await expect(page.getByText('No tickets here.')).toBeVisible()

    await page.getByRole('link', { name: 'Categories & routing' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Categories & routing')
    await expect(page.getByText(/No categories yet/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add category' })).toHaveCount(0)

    await page.goto('/en/app/northbridge/requests')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My requests')
    await expect(page.getByText('You have no requests yet.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'New request' })).toHaveCount(0)
    await page.goto('/en/app/northbridge/requests/new')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New request')
    await expect(page.getByRole('button', { name: 'Send request' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Notifications' }).click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/notifications$/)
    await expect(page.getByText('No notifications.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('navigation lists requests and tickets as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    for (const name of [/My requests/, /Tickets/]) {
      const link = nav.getByRole('link', { name })
      await expect(link).toBeVisible()
      await expect(link).not.toContainText('P7')
    }
  })

  test('unknown tickets and requests are not found', async ({ page }) => {
    for (const path of ['/en/app/northbridge/tickets/00000000-0000-4000-8000-000000000000', '/en/app/northbridge/requests/00000000-0000-4000-8000-000000000000', '/en/app/northbridge/tickets/not-a-uuid']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    }
  })

  test('Arabic ticket pages are translated', async ({ page }) => {
    await page.goto('/ar/app/northbridge/tickets')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('التذاكر')
    await page.goto('/ar/app/northbridge/requests')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلباتي')
  })

  for (const path of ['/en/app/northbridge/tickets', '/en/app/northbridge/requests/new', '/ar/app/northbridge/tickets/categories', '/ar/app/northbridge/notifications']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
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
