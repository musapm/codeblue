import { vi } from 'vitest'

// The assistant modules are server-only; evals run them directly in Node.
vi.mock('server-only', () => ({}))
