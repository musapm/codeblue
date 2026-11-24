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
    await page.goto('/en/platform/settings')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Platform settings')
    await expect(page.getByText('Planned · Phase 16').first()).toBeVisible()
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

test.describe('analytics and AI quality (UI preview mode)', () => {
  test('analytics shows no figures without data, and offers the periods', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/analytics')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Analytics')
    await expect(page.getByText('Preview mode has no data behind it, so no figures are shown.')).toBeVisible()
    const periods = page.getByRole('navigation', { name: 'Period' })
    for (const name of ['Last 7 days', 'Last 30 days', 'Last 90 days']) await expect(periods.getByRole('link', { name })).toBeVisible()
    await periods.getByRole('link', { name: 'Last 7 days' }).click()
    await expect(page).toHaveURL(/\/analytics\?days=7$/)
    await expect(periods.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('aria-current', 'page')
    expect(errors).toEqual([])
  })

  test('the overview keeps its honest notice in preview mode', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    await expect(page.getByText('No sample numbers are shown.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Last 7 days' })).toHaveCount(0)
  })

  test('AI quality explains its privacy rules, has its queues and offers no reviews without data', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/quality')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AI quality')
    await expect(page.getByText(/Contact details, links and long numbers are hidden automatically/)).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'AI quality' })
    for (const name of ['Unanswered', 'Rated not helpful', 'Declined']) await expect(tabs.getByRole('link', { name })).toBeVisible()
    await expect(page.getByText('No unanswered questions here.')).toBeVisible()
    await tabs.getByRole('link', { name: 'Rated not helpful' }).click()
    await expect(page).toHaveURL(/tab=negative/)
    await expect(page.getByText('No answers rated not helpful here.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Save review/ })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('navigation lists analytics and AI quality as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    for (const name of [/Analytics/, /AI quality/]) {
      const link = nav.getByRole('link', { name })
      await expect(link).toBeVisible()
      await expect(link).not.toContainText('P8')
    }
  })

  test('Arabic analytics pages are translated', async ({ page }) => {
    await page.goto('/ar/app/northbridge/analytics')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('التحليلات')
    await page.goto('/ar/app/northbridge/quality')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('جودة الذكاء الاصطناعي')
  })

  test('the student chat tells people that unanswered and rated questions may be reviewed', async ({ page }) => {
    await page.goto('/en/app/northbridge/ask')
    await expect(page.getByText(/may be reviewed by university staff without your name/)).toBeVisible()
  })

  for (const path of ['/en/app/northbridge/analytics', '/en/app/northbridge/quality?tab=negative', '/ar/app/northbridge/quality']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('academic assistant (UI preview mode)', () => {
  test('my courses and the academic admin render honestly without data and offer no writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/courses')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My courses')
    await expect(page.getByText('You are not in any course yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Join' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Manage all courses' }).click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/academic$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Academic assistant')
    await expect(page.getByText('No courses yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create course' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('navigation lists my courses and the academic assistant as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    for (const name of [/My courses/, /Academic assistant/]) {
      const link = nav.getByRole('link', { name })
      await expect(link).toBeVisible()
      await expect(link).not.toContainText('P9')
    }
  })

  test('unknown courses and study aids are not found', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000000'
    for (const path of [`/en/app/northbridge/courses/${id}`, `/en/app/northbridge/courses/${id}/manage`, `/en/app/northbridge/courses/${id}/study/${id}`, '/en/app/northbridge/courses/not-a-uuid']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    }
  })

  test('Arabic academic pages are translated', async ({ page }) => {
    await page.goto('/ar/app/northbridge/courses')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مقرراتي')
    await page.goto('/ar/app/northbridge/academic')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('المساعد الأكاديمي')
  })

  for (const path of ['/en/app/northbridge/courses', '/ar/app/northbridge/academic']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('staff assistant (UI preview mode)', () => {
  test('ask, drafts, ticket digest and settings render honestly without data and offer no writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/staff-assistant')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff assistant')
    const composer = page.getByRole('textbox', { name: 'Ask about a policy, procedure or deadline…' })
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', 'UI preview mode: the staff assistant does not run without a backend.')
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
    await expect(page.getByText('No conversations yet.')).toBeVisible()
    await expect(page.getByText(/do not forward internal details/)).toBeVisible()

    const main = page.getByRole('main')
    await main.getByRole('link', { name: 'Drafts', exact: true }).click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/staff-assistant\/drafts$/)
    await expect(page.getByRole('heading', { name: 'Write a draft with AI' })).toBeVisible()
    await expect(page.getByText('No drafts yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Write draft' })).toHaveCount(0)

    await main.getByRole('link', { name: 'Ticket digest', exact: true }).click()
    await expect(page).toHaveURL(/\/staff-assistant\/tickets$/)
    await expect(page.getByRole('heading', { name: 'Ticket digest' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Summarize' })).toHaveCount(0)

    await main.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/staff-assistant\/settings$/)
    await expect(page.getByRole('heading', { name: 'Staff assistant settings' })).toBeVisible()
    await expect(page.getByText('No use yet this month.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('navigation lists the staff assistant as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    const link = nav.getByRole('link', { name: /Staff assistant/ })
    await expect(link).toBeVisible()
    await expect(link).not.toContainText('P10')
    await link.click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/staff-assistant$/)
  })

  test('unknown drafts are not found', async ({ page }) => {
    for (const path of ['/en/app/northbridge/staff-assistant/drafts/00000000-0000-4000-8000-000000000000', '/en/app/northbridge/staff-assistant/drafts/not-a-uuid']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    }
  })

  test('Arabic staff pages are translated and right-to-left', async ({ page }) => {
    await page.goto('/ar/app/northbridge/staff-assistant')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مساعد الموظفين')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await page.goto('/ar/app/northbridge/staff-assistant/drafts')
    await expect(page.getByRole('heading', { name: 'اكتب مسودة بالذكاء الاصطناعي' })).toBeVisible()
  })

  test('the staff endpoint refuses cross-site requests and does nothing in preview mode', async ({ request, baseURL }) => {
    const body = { question: 'What is the leave policy?', locale: 'en', departmentId: null }
    const crossSite = await request.post('/api/staff-assistant/northbridge', { data: body, headers: { Origin: 'https://evil.example' } })
    expect(crossSite.status()).toBe(403)
    const preview = await request.post('/api/staff-assistant/northbridge', { data: body, headers: { Origin: new URL(baseURL!).origin } })
    expect(preview.status()).toBe(503)
    expect(await preview.json()).toEqual({ error: 'preview' })
  })

  for (const path of ['/en/app/northbridge/staff-assistant', '/ar/app/northbridge/staff-assistant/drafts', '/en/app/northbridge/staff-assistant/tickets', '/en/app/northbridge/staff-assistant/settings']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('service request workflows (UI preview mode)', () => {
  test('requesters see the services page honestly without data and cannot submit', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/services')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Service requests')
    await expect(page.getByText('UI preview mode: nothing can be submitted without a backend.')).toBeVisible()
    await expect(page.getByText('No request forms are available yet.')).toBeVisible()
    await expect(page.getByText('You have not made any requests yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Find the form' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('staff see the queue, forms and settings without data and without writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/workflows')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Service requests')
    await expect(page.getByText('No requests here.')).toBeVisible()
    const main = page.getByRole('main')
    await main.getByRole('link', { name: 'Forms', exact: true }).click()
    await expect(page).toHaveURL(/\/workflows\/forms$/)
    await expect(page.getByText('No forms yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create form' })).toHaveCount(0)
    await main.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/workflows\/settings$/)
    await expect(page.getByRole('heading', { name: 'Form suggestions (AI)' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('navigation lists service requests and the staff module as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    for (const name of [/Service requests/, /Requests & workflows/]) {
      const link = nav.getByRole('link', { name })
      await expect(link).toBeVisible()
      await expect(link).not.toContainText('P11')
    }
  })

  test('unknown forms and requests are not found', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000000'
    for (const path of [`/en/app/northbridge/services/new/${id}`, `/en/app/northbridge/services/${id}`, `/en/app/northbridge/workflows/requests/${id}`, `/en/app/northbridge/workflows/forms/${id}`, '/en/app/northbridge/services/not-a-uuid']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    }
  })

  test('Arabic workflow pages are translated', async ({ page }) => {
    await page.goto('/ar/app/northbridge/services')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلبات الخدمات')
    await page.goto('/ar/app/northbridge/workflows/forms')
    await expect(page.getByRole('heading', { name: 'نماذج الطلبات' })).toBeVisible()
  })

  for (const path of ['/en/app/northbridge/services', '/en/app/northbridge/workflows', '/en/app/northbridge/workflows/forms', '/ar/app/northbridge/workflows/settings']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('campus map and assistant (UI preview mode)', () => {
  test('the directory, management and settings render honestly without data and offer no writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/campus')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Campus')
    await expect(page.getByText('UI preview mode: no locations without a backend.')).toBeVisible()
    await expect(page.getByText('No published location has coordinates yet, so there is no map.')).toBeVisible()
    await expect(page.getByText('No locations have been published yet.')).toBeVisible()
    await expect(page.getByRole('searchbox').or(page.getByRole('textbox', { name: /Search the campus/ }))).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ask' })).toHaveCount(0)
    const main = page.getByRole('main')
    await main.getByRole('link', { name: 'Manage locations', exact: true }).click()
    await expect(page).toHaveURL(/\/campus\/manage$/)
    await expect(page.getByText('No locations yet.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add a location' })).toHaveCount(0)
    await main.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Campus answers (AI)' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('navigation lists the campus as available', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    const link = nav.getByRole('link', { name: /Campus/ })
    await expect(link).toBeVisible()
    await expect(link).not.toContainText('P12')
  })

  test('unknown locations are not found, and nothing can be created in preview', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000000'
    for (const path of [`/en/app/northbridge/campus/${id}`, `/en/app/northbridge/campus/manage/${id}`, '/en/app/northbridge/campus/manage/new', '/en/app/northbridge/campus/not-a-uuid']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    }
  })

  test('Arabic campus pages are translated', async ({ page }) => {
    await page.goto('/ar/app/northbridge/campus')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الحرم الجامعي')
    await page.goto('/ar/app/northbridge/campus/settings')
    await expect(page.getByRole('heading', { name: 'إجابات الحرم الجامعي (الذكاء الاصطناعي)' })).toBeVisible()
  })

  for (const path of ['/en/app/northbridge/campus', '/en/app/northbridge/campus/manage', '/ar/app/northbridge/campus/settings']) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('voice (UI preview mode)', () => {
  test('the voice settings render without data, explain the choice of provider and offer no writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/voice')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Voice')
    await expect(page.getByRole('heading', { name: 'Choosing a provider' })).toBeVisible()
    await expect(page.getByText(/Arabic accuracy/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' }).first()
    await expect(nav.getByRole('link', { name: /Voice/ })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('the voice endpoints refuse cross-site requests and need a backend', async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const crossSite = await request.post('/api/voice/northbridge/speak', { data: { text: 'Hello', surface: 'student_chat', locale: 'en' }, headers: { Origin: 'https://evil.example' } })
    expect(crossSite.status()).toBe(403)
    const preview = await request.post('/api/voice/northbridge/speak', { data: { text: 'Hello', surface: 'student_chat', locale: 'en' }, headers: { Origin: origin } })
    expect(preview.status()).toBe(503)
    expect(await preview.json()).toEqual({ error: 'preview' })
    const transcribe = await request.post('/api/voice/northbridge/transcribe', { multipart: { surface: 'student_chat', locale: 'en' }, headers: { Origin: 'https://evil.example' } })
    expect(transcribe.status()).toBe(403)
  })

  test('the student chat shows no voice controls when voice is not available', async ({ page }) => {
    await page.goto('/en/app/northbridge/ask')
    await expect(page.getByRole('button', { name: 'Speak your question' })).toHaveCount(0)
  })

  test('Arabic voice page is translated and has no serious accessibility violations', async ({ page }) => {
    await page.goto('/ar/app/northbridge/voice')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الصوت')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
  })
})

test.describe('notifications and integrations (UI preview mode)', () => {
  test('notification settings list every kind, default to in-app only and offer no writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/notifications')
    await page.getByRole('link', { name: 'Notification settings' }).click()
    await expect(page).toHaveURL(/\/notifications\/settings$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notification settings')
    await expect(page.getByText(/Email delivery is not connected yet/)).toBeVisible()
    const inApp = page.getByRole('checkbox', { name: 'Requests assigned to me: In the app', exact: true })
    await expect(inApp).toBeChecked()
    await expect(inApp).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Requests assigned to me: By email', exact: true })).not.toBeChecked()
    await expect(page.getByRole('checkbox')).toHaveCount(16)
    expect(errors).toEqual([])
  })

  test('integrations show the catalog and the outbox honestly, without data or writes', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge/integrations')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Integrations')
    await expect(page.getByText('No integrations yet.')).toBeVisible()
    await expect(page.getByText('Learning management (LMS)')).toBeVisible()
    await expect(page.getByText(/No connector of this kind runs yet/)).toBeVisible()
    await expect(page.getByText(/No email provider is connected/)).toBeVisible()
    await expect(page.getByText('Planned · Phase 14')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('an integration page needs real data', async ({ page }) => {
    await page.goto('/en/app/northbridge/integrations/00000000-0000-4000-8000-000000000001')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })

  for (const path of ['/ar/app/northbridge/integrations', '/ar/app/northbridge/notifications/settings']) {
    test(`${path} is translated and has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/التكامل|إعدادات الإشعارات/)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('plans, subscriptions and usage (UI preview mode)', () => {
  test('plans render without data and without writes, and are no longer labelled planned', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/platform/plans')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plans & subscriptions')
    await expect(page.getByText(/none are built into the product/)).toBeVisible()
    await expect(page.getByText('No plans yet. Universities without a plan work without limits.')).toBeVisible()
    await expect(page.getByText('Planned · Phase 15')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create plan' })).toHaveCount(0)
    const nav = page.getByRole('navigation', { name: 'Platform console' }).first()
    await expect(nav.getByRole('link', { name: /Usage & AI costs/ })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('the usage report moves between months and shows no data in preview', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/platform/usage?month=2026-03')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usage & AI costs')
    await expect(page.getByRole('heading', { name: 'March 2026' })).toBeVisible()
    await expect(page.getByText('There is no data in preview mode.')).toBeVisible()
    await page.getByRole('link', { name: 'Next month' }).click()
    await expect(page).toHaveURL(/month=2026-04$/)
    await page.goto('/en/platform/usage?month=2026-13')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usage & AI costs') // invalid month: the current one
    await expect(page.getByRole('button', { name: 'Check renewals now' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('plan and subscription pages need real data', async ({ page }) => {
    for (const path of ['/en/platform/plans/00000000-0000-4000-8000-000000000001', '/en/platform/tenants/northbridge/subscription']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    }
  })

  for (const path of ['/ar/platform/plans', '/ar/platform/usage']) {
    test(`${path} is translated and has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/الخطط والاشتراكات|الاستخدام وتكاليف الذكاء الاصطناعي/)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  }
})

test.describe('content security policy on signed-in pages', () => {
  test('a fresh nonce per request, no inline scripts allowed, and the page still works', async ({ page, request }) => {
    const first = (await request.get('/en/app/northbridge')).headers()['content-security-policy'] ?? ''
    const second = (await request.get('/en/app/northbridge')).headers()['content-security-policy'] ?? ''
    const nonce = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce(first)).toBeTruthy()
    expect(nonce(first)).not.toBe(nonce(second))
    expect(first).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect((await request.get('/en/pricing')).headers()['content-security-policy']).toMatch(/script-src[^;]*unsafe-inline/) // prerendered public pages

    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge')
    await page.getByRole('button', { name: 'Switch workspace' }).click() // needs the page's scripts to run
    await expect(page.getByRole('menuitem', { name: /Al-Noor Institute of Technology/ })).toBeVisible()
    expect(errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([])
    expect(errors).toEqual([])
  })
})

test.describe('two-step sign-in (UI preview mode)', () => {
  test('the account menu links to two-step sign-in; the page explains it without a backend', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/en/app/northbridge')
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Two-step sign-in' }).click()
    await expect(page).toHaveURL(/\/en\/two-step$/)
    await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible()
    await expect(page.getByText('Authentication is not configured', { exact: false }).first()).toBeVisible()
    expect(errors).toEqual([])
  })

  test('the code step needs a real session', async ({ page }) => {
    await page.goto('/ar/login/verify?next=/ar/platform')
    await expect(page).toHaveURL(/\/ar\/login(\?|$)/)
  })
})

test.describe('monitoring', () => {
  test('the health check answers without secrets, and the deep check says what is not configured', async ({ request }) => {
    const basic = await request.get('/api/health')
    expect(basic.status()).toBe(200)
    expect(basic.headers()['cache-control']).toContain('no-store')
    const body = await basic.json()
    expect(body).toMatchObject({ status: 'ok', checks: { supabase: 'not_configured' } })
    expect(Object.keys(body).sort()).toEqual(['checks', 'status', 'time', 'version'])
    const deep = await (await request.get('/api/health?deep=1')).json()
    expect(deep.checks).toEqual({ supabase: 'not_configured', auth: 'not_configured' })
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
