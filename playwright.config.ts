import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = `http://127.0.0.1:${PORT}`

/**
 * E2E tests run against a production build (`next build && next start`).
 * Supabase is intentionally NOT configured, and UI preview mode is enabled, so the
 * suite verifies the "not configured" auth states and the dashboard shell without
 * touching any real backend. See docs/testing.md.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'off',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT} --hostname 127.0.0.1`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      UNIAGENT_UI_PREVIEW: 'true',
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
})
