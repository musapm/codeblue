import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// `server-only` throws when imported outside a React Server environment.
// Unit tests exercise server modules directly, so neutralize it here.
vi.mock('server-only', () => ({}))
