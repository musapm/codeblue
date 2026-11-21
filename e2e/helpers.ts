import type { Page } from '@playwright/test'

/** Collects console errors and uncaught page errors during a test. */
export function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

export const MARKETING_PATHS = ['', '/product', '/features', '/solutions', '/pricing', '/demo', '/about', '/contact', '/privacy', '/terms']
export const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password']
