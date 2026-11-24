// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appVersion, buildErrorReport, reportRequestError } from './errors'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('server error reports', () => {
  it('keep the route and the error, never the query string or personal data', () => {
    const error = Object.assign(new Error('duplicate key (email)=(sara@uni.example)'), { digest: '12345' })
    const r = buildErrorReport(error, { path: '/en/app/northbridge/tickets?search=sara@uni.example', method: 'POST' }, { routePath: '/[lang]/app/[tenant]/tickets', routeType: 'action' }, new Date('2026-11-24T10:00:00Z'))
    expect(r).toMatchObject({ route: '/[lang]/app/[tenant]/tickets', type: 'action', method: 'POST', path: '/en/app/northbridge/tickets', digest: '12345', name: 'Error', time: '2026-11-24T10:00:00.000Z' })
    expect(r.message).toBe('duplicate key (email)=([email])')
    expect(JSON.stringify(r)).not.toContain('sara')
  })

  it('reports non-errors and long messages safely', () => {
    expect(buildErrorReport('boom', { path: '/x', method: 'GET' }, {})).toMatchObject({ name: 'string', message: 'boom', digest: null, route: null })
    expect(buildErrorReport(new Error('x'.repeat(2000)), { path: '/x', method: 'GET' }, {}).message).toHaveLength(500)
  })

  it('the version comes from the host', () => {
    expect(appVersion({ VERCEL_GIT_COMMIT_SHA: 'abcdef1234567' })).toBe('abcdef1')
    expect(appVersion({ APP_VERSION: '1.0.0' })).toBe('1.0.0')
    expect(appVersion({})).toBeNull()
  })

  it('forwards to ERROR_REPORT_URL only when it is https', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('ERROR_REPORT_URL', 'http://insecure.example/hook')
    await reportRequestError(new Error('x'), { path: '/x', method: 'GET' }, {})
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('ERROR_REPORT_URL', 'https://logs.example/hook')
    await reportRequestError(new Error('x'), { path: '/x', method: 'GET' }, {})
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ level: 'error', path: '/x' })
  })
})
