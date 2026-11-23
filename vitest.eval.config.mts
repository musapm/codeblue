import { defineConfig } from 'vitest/config'

/**
 * Live AI evals (opt-in: RUN_AI_EVALS=1 and ANTHROPIC_API_KEY). They call the Claude API and
 * cost money, so they are never part of `npm test`. See docs/ai-evals.md.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['evals/**/*.eval.ts'],
    setupFiles: ['./evals/setup.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
    maxConcurrency: 1,
  },
})
