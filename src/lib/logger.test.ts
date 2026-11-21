import { describe, expect, it } from 'vitest'
import { createLogger, isSensitiveKey, REDACTED, redact } from './logger'

describe('redact', () => {
  it('redacts sensitive keys recursively', () => {
    const out = redact({
      user: { id: 'u1', email: 'a@b.c', password: 'hunter2' },
      headers: { authorization: 'Bearer x', cookie: 'sb=1' },
      apiKey: 'sk-123',
      nested: [{ accessToken: 't', ok: true }],
    }) as {
      user: Record<string, unknown>
      headers: Record<string, unknown>
      apiKey: unknown
      nested: Record<string, unknown>[]
    }
    expect(out.user.id).toBe('u1')
    expect(out.user.email).toBe(REDACTED)
    expect(out.user.password).toBe(REDACTED)
    expect(out.headers.authorization).toBe(REDACTED)
    expect(out.headers.cookie).toBe(REDACTED)
    expect(out.apiKey).toBe(REDACTED)
    expect(out.nested[0]?.accessToken).toBe(REDACTED)
    expect(out.nested[0]?.ok).toBe(true)
  })

  it('keeps token usage counters', () => {
    expect(isSensitiveKey('inputTokens')).toBe(false)
    expect(isSensitiveKey('output_tokens')).toBe(false)
    expect(isSensitiveKey('tokenCount')).toBe(false)
    expect(isSensitiveKey('refreshToken')).toBe(true)
  })

  it('handles circular structures and errors', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(redact(a)).toEqual({ name: 'a', self: '[Circular]' })
    const err = redact(new Error('boom')) as { message: string }
    expect(err.message).toBe('boom')
  })
})

describe('createLogger', () => {
  it('writes JSON lines with bindings and redaction', () => {
    const lines: string[] = []
    const log = createLogger({ service: 'test' }, { json: true, level: 'debug', sink: (_l, line) => lines.push(line) })
    log.child({ requestId: 'r1' }).info('hello', { password: 'x', count: 2 })
    const parsed = JSON.parse(lines[0]!)
    expect(parsed).toMatchObject({ level: 'info', msg: 'hello', service: 'test', requestId: 'r1', password: REDACTED, count: 2 })
  })

  it('respects the minimum level', () => {
    const lines: string[] = []
    const log = createLogger({}, { level: 'warn', sink: (_l, line) => lines.push(line) })
    log.info('skip')
    log.warn('keep')
    expect(lines).toHaveLength(1)
  })
})
