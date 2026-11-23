import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

/**
 * LIVE Phase 4 test (knowledge base) against a real Supabase project (not run by default).
 *
 * Uses a university where LIVE_NEW_OWNER_* is an active owner (LIVE_KNOWLEDGE_TENANT_SLUG) and
 * LIVE_NEW_STUDENT_* is a member (active or suspended; the test reactivates them).
 * Uploads real PDF/DOCX fixtures through the UI (signed direct upload → verification →
 * background processing), checks extraction, publishing, versioning, Arabic and English search,
 * retrieval isolation for a student through the real API (T17), and deletion.
 */

const live = process.env.LIVE_E2E === '1' && Boolean(process.env.LIVE_KNOWLEDGE_TENANT_SLUG)
test.skip(!live, 'Set LIVE_E2E=1, LIVE_KNOWLEDGE_TENANT_SLUG and the LIVE_* credentials to run')
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const env = (name: string) => process.env[name] ?? ''
const SLUG = env('LIVE_KNOWLEDGE_TENANT_SLUG')
const kb = (path = '') => `/en/app/${SLUG}/knowledge${path}`
const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'knowledge', '__fixtures__', name))

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/en/login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.endsWith('/login'))
}

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, meta: { title: string; visibility?: string }) {
  await page.goto(kb())
  await page.locator('input[name="file"]:visible').setInputFiles(file)
  await page.locator('input[name="title"]').fill(meta.title)
  if (meta.visibility) await page.locator(`input[name="visibility"][value="${meta.visibility}"]`).check()
  await page.getByRole('button', { name: 'Upload and process' }).click()
}

/** Open a document from the list once processing has finished (auto-refresh keeps the list fresh). */
async function openWhenProcessed(page: Page, title: string, expected: RegExp) {
  const row = page.getByRole('link').filter({ hasText: title })
  await expect(row).toContainText(expected, { timeout: 60_000 })
  await row.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
}

const studentClient = async () => {
  const sb = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } })
  const { error } = await sb.auth.signInWithPassword({ email: env('LIVE_NEW_STUDENT_EMAIL'), password: env('LIVE_NEW_STUDENT_PASSWORD') })
  if (error) throw new Error(`student sign-in failed: ${error.code}`)
  return sb
}

test('owner uploads an English PDF; text, pages and publishing work', async ({ page }) => {
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await upload(page, { name: 'handbook.pdf', mimeType: 'application/pdf', buffer: fixture('handbook-en.pdf') }, { title: 'Student Handbook 2026', visibility: 'members' })
  await expect(page.getByText('Uploaded. Processing has started')).toBeVisible({ timeout: 30_000 })
  await openWhenProcessed(page, 'Student Handbook 2026', /Ready · not published/)
  await expect(page.getByText(/tuition fee for undergraduate programs is 1200/)).toBeVisible()
  await expect(page.getByText('p. 1').first()).toBeVisible()
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible()
})

test('Arabic PDF is read in reading order; DOCX staff document; scanned PDF needs OCR', async ({ page }) => {
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await upload(page, { name: 'guide-ar.pdf', mimeType: 'application/pdf', buffer: fixture('handbook-ar.pdf') }, { title: 'Arabic student guide', visibility: 'members' })
  await openWhenProcessed(page, 'Arabic student guide', /Ready · not published/)
  await expect(page.getByText(/تُدفع الرسوم الدراسية في مكتب الشؤون المالية/)).toBeVisible()
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible()

  await upload(page, { name: 'policy.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fixture('policy.docx') }, { title: 'Exam postponement policy (staff)', visibility: 'staff' })
  await openWhenProcessed(page, 'Exam postponement policy (staff)', /Ready · not published/)
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible()

  await upload(page, { name: 'scan.pdf', mimeType: 'application/pdf', buffer: fixture('scanned.pdf') }, { title: 'Scanned form' })
  await openWhenProcessed(page, 'Scanned form', /Needs OCR/)
  await expect(page.getByText(/scanned PDF without a text layer/)).toBeVisible()
})

test('a renamed non-PDF is refused after upload, by content', async ({ page }) => {
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await upload(page, { name: 'evil.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html><script>alert(1)</script></html>') }, { title: 'Disguised file' })
  await expect(page.getByText('Use a PDF, Word (DOCX), plain text (TXT) or CSV file.')).toBeVisible({ timeout: 30_000 })
})

test('test search: English and Arabic, published documents only', async ({ page }) => {
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await page.goto(kb())
  const search = page.getByRole('search')
  await search.getByRole('textbox').fill('How much is the tuition fee?')
  await search.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'tuition fee' }).first()).toContainText('Student Handbook 2026')
  await search.getByRole('textbox').fill('أين تدفع الرسوم الدراسية؟')
  await search.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'مكتب الشؤون المالية' }).first()).toContainText('Arabic student guide')
})

test('T17 live: a student retrieves members documents but never staff-only ones', async ({ page }) => {
  // Make sure the student is active (the Phase 3 run suspended them).
  page.on('dialog', (d) => void d.accept())
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await page.goto(`/en/app/${SLUG}/members`)
  const row = page.getByRole('listitem').filter({ hasText: env('LIVE_NEW_STUDENT_EMAIL') }).filter({ has: page.getByText('Manage') })
  if (await row.getByText('Suspended').count()) {
    await row.getByText('Manage').click()
    await row.getByRole('button', { name: 'Reactivate' }).click()
    await expect(row.getByText('Active', { exact: true })).toBeVisible()
  }

  const sb = await studentClient()
  const members = await sb.rpc('search_knowledge', { p_tenant_slug: SLUG, p_query: 'tuition fee semester', p_limit: 10 })
  expect(members.error).toBeNull()
  expect((members.data as { title: string }[]).map((r) => r.title)).toContain('Student Handbook 2026')
  const staff = await sb.rpc('search_knowledge', { p_tenant_slug: SLUG, p_query: 'postpone exam medical certificate', p_limit: 10 })
  expect((staff.data as { title: string }[]).map((r) => r.title)).not.toContain('Exam postponement policy (staff)')
  const direct = await sb.from('knowledge_chunks').select('content').ilike('content', '%postpone%')
  expect(direct.data ?? []).toEqual([])
  const other = await sb.rpc('search_knowledge', { p_tenant_slug: 'northbridge', p_query: 'tuition', p_limit: 5 })
  expect(other.error?.code).toBe('42501')
  await sb.auth.signOut()

  await signIn(page, env('LIVE_NEW_STUDENT_EMAIL'), env('LIVE_NEW_STUDENT_PASSWORD'))
  await page.goto(kb())
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('a new version replaces the old passages; deletion removes document and file', async ({ page }) => {
  await signIn(page, env('LIVE_NEW_OWNER_EMAIL'), env('LIVE_NEW_OWNER_PASSWORD'))
  await page.goto(kb())
  await page.getByRole('link').filter({ hasText: 'Exam postponement policy (staff)' }).click()
  // Next.js keeps the previous page mounted but hidden: wait for the detail page and use visible controls only.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Exam postponement policy (staff)')
  const v2 = Buffer.from('Exam Postponement Policy (2027)\n\nStudents may postpone one exam per semester. Requests go to the registrar within 3 days.')
  await page.locator('input[name="file"]:visible').setInputFiles({ name: 'policy-v2.txt', mimeType: 'text/plain', buffer: v2 })
  await page.getByRole('button', { name: 'Upload and process' }).click()
  await expect(page.getByText(/Requests go to the registrar within 3 days/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/postpone an exam for medical reasons/)).toHaveCount(0)

  page.on('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Delete document' }).click()
  await expect(page).toHaveURL(new RegExp(`${kb()}$`))
  await expect(page.getByRole('link').filter({ hasText: 'Exam postponement policy (staff)' })).toHaveCount(0)
})
