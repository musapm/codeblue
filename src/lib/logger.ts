/**
 * Minimal structured logger with automatic redaction.
 *
 * - Production: one JSON object per line (ingestible by any log pipeline).
 * - Development: readable single-line output.
 * - Keys that commonly hold secrets or personal data are redacted recursively, and email
 *   addresses inside any string (for example a database error message) are masked.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|session|credential|private[-_]?key|^email$|phone|ssn|national[-_]?id/i
// What people write or say, and who they are: never logged (Phase 16 log review).
const PERSONAL_KEY = /^(question|answer|prompt|content|body|transcript|reply|draft|ip|ip_?address|client_?ip|full_?name|display_?name|recipient|to|address)$/i
const EMAIL_IN_TEXT = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi
// Usage counters such as `inputTokens` / `output_tokens` / `tokenCount` are not secrets.
const NON_SENSITIVE_KEY = /tokens$|token_?count$|^(max|total)_?tokens/i

export function isSensitiveKey(key: string): boolean {
  return (SENSITIVE_KEY.test(key) && !NON_SENSITIVE_KEY.test(key)) || PERSONAL_KEY.test(key)
}

/** Masks email addresses inside free text. */
export const maskEmails = (text: string) => text.replace(EMAIL_IN_TEXT, '[email]')

export const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskEmails(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[Truncated]'
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    return { name: value.name, message: maskEmails(value.message), ...(process.env.NODE_ENV !== 'production' && { stack: value.stack }) }
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen))

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1, seen)
  }
  return out
}

export type Logger = {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(bindings: LogFields): Logger
}

type Sink = (level: LogLevel, line: string) => void

const defaultSink: Sink = (level, line) => {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(line)
}

export function createLogger(
  bindings: LogFields = {},
  options: { level?: LogLevel; json?: boolean; sink?: Sink } = {},
): Logger {
  const minLevel: LogLevel = options.level ?? ((process.env.LOG_LEVEL as LogLevel | undefined) || 'info')
  const json = options.json ?? process.env.NODE_ENV === 'production'
  const sink = options.sink ?? defaultSink

  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
    const payload = redact({ ...bindings, ...fields }) as LogFields
    if (json) {
      sink(level, JSON.stringify({ level, msg, time: new Date().toISOString(), ...payload }))
    } else {
      const extra = Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : ''
      sink(level, `[${level}] ${msg}${extra}`)
    }
  }

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (more) => createLogger({ ...bindings, ...more }, options),
  }
}

export const logger = createLogger({ service: 'uniagent-web' })
