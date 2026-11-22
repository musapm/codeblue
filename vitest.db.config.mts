import { defineConfig } from 'vitest/config'

/** Database (RLS / tenant isolation) tests. Requires TEST_DATABASE_URL; see docs/testing.md. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
