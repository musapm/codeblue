import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e'],
    restoreMocks: true,
    // pdf.js may reject an internal promise late on a damaged PDF; production logs it through
    // src/lib/knowledge/pdf-guard.ts. Only pdf.js's own error types are ignored here.
    onUnhandledError: (error) => !['XRefEntryException', 'XRefParseException', 'FormatError', 'InvalidPDFException', 'UnknownErrorException', 'MissingDataException', 'ParserEOFException'].includes(String((error as { name?: unknown }).name)),
  },
})
