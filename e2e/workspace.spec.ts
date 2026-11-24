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

test.describe('workspace on mobile @mobile', () => {
  test('sidebar is available from the menu button', async ({ page }) => {
    await page.goto('/en/app/northbridge')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('link', { name: /Settings/ }).click()
    await expect(page).toHaveURL(/\/en\/app\/northbridge\/settings$/)
  })
})
