import { describe, expect, it } from 'vitest'
import { clientIpFromHeaders, createMemoryRateLimiter } from './rate-limit'

describe('createMemoryRateLimiter', () => {
  it('allows up to the limit within a window, then blocks', () => {
    let t = 1_000
    const limiter = createMemoryRateLimiter({ limit: 3, windowMs: 1_000, now: () => t })
    expect(limiter.check('k').allowed).toBe(true)
    expect(limiter.check('k').allowed).toBe(true)
    expect(limiter.check('k').remaining).toBe(0)
    const blocked = limiter.check('k')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(1_000)

    t += 1_001
    expect(limiter.check('k').allowed).toBe(true)
  })

  it('tracks keys independently', () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
  })

  it('bounds memory by evicting the least recently used key', () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 })
    limiter.check('a')
    limiter.check('b')
    limiter.check('c') // evicts "a"
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('rejects invalid configuration', () => {
    expect(() => createMemoryRateLimiter({ limit: 0, windowMs: 1 })).toThrow()
  })
})

describe('clientIpFromHeaders', () => {
  it('reads only the header the deployment trusts', () => {
    const spoofed = new Headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.2', 'cf-connecting-ip': '198.51.100.2', 'x-real-ip': '10.0.0.9' })
    expect(clientIpFromHeaders(spoofed, undefined)).toBe('1.2.3.4') // default: Vercel, which overwrites x-forwarded-for
    expect(clientIpFromHeaders(spoofed, 'cf-connecting-ip')).toBe('198.51.100.2') // behind Cloudflare
    expect(clientIpFromHeaders(spoofed, 'x-real-ip')).toBe('10.0.0.9')
    expect(clientIpFromHeaders(spoofed, 'x-anything')).toBe('1.2.3.4') // unknown setting: the default
    expect(clientIpFromHeaders(new Headers({ 'cf-connecting-ip': '198.51.100.2' }), undefined)).toBe('unknown') // no fallback to other headers
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': 'x'.repeat(200) }), undefined)).toBe('unknown')
  })
})
