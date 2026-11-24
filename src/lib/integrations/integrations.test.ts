// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { deliverQueued, getEmailSender, type EmailSender, type Outbox } from '../notifications/email'
import { NOTIFICATION_KINDS, preferenceSchema } from '../notifications/schemas'
import { configLines, integrationSchema, parseConfigLines } from './schemas'

describe('integration settings', () => {
  it('reads "name = value" lines and refuses secret-like names', () => {
    expect(parseConfigLines('base_url = https://lms.example.edu\n\n Site_ID=42 ')).toEqual({ base_url: 'https://lms.example.edu', site_id: '42' })
    expect(parseConfigLines('')).toEqual({})
    for (const bad of ['api_key = x', 'client_secret = x', 'password=x', 'token = x', 'no equals sign', '9lives = x']) expect(parseConfigLines(bad)).toBeNull()
    expect(parseConfigLines(Array.from({ length: 31 }, (_, i) => `k${i} = v`).join('\n'))).toBeNull()
    expect(configLines({ base_url: 'https://x', site_id: '42' })).toBe('base_url = https://x\nsite_id = 42')
    expect(configLines(null)).toBe('')
  })

  it('validates the form: kind, name, settings and a secret NAME only', () => {
    expect(integrationSchema.parse({ kind: 'lms', name: 'Moodle', config: 'base_url = https://x', secretRef: 'MOODLE_TOKEN' })).toEqual({ kind: 'lms', name: 'Moodle', config: { base_url: 'https://x' }, secretRef: 'MOODLE_TOKEN' })
    expect(integrationSchema.parse({ kind: 'sso', name: 'Campus SSO', secretRef: '' })).toMatchObject({ config: {}, secretRef: null })
    const err = (v: Record<string, unknown>) => integrationSchema.safeParse({ kind: 'lms', name: 'Moodle', ...v }).error?.issues[0]?.message
    expect(err({ secretRef: 'sk-live-123' })).toBe('integrationSecretRef')
    expect(err({ secretRef: 'moodle_token' })).toBe('integrationSecretRef')
    expect(err({ config: 'password = hunter2' })).toBe('integrationConfig')
    expect(err({ name: 'x' })).toBe('nameRequired')
    expect(err({ kind: 'ftp' })).toBeDefined()
  })

  it('preferences name a known kind and both channels', () => {
    expect(NOTIFICATION_KINDS).toHaveLength(8)
    expect(preferenceSchema.safeParse({ tenant: 'uni', kind: 'ticket_reply', inApp: true, email: false }).success).toBe(true)
    expect(preferenceSchema.safeParse({ tenant: 'uni', kind: 'marketing', inApp: true, email: true }).success).toBe(false)
    expect(preferenceSchema.safeParse({ tenant: 'uni', kind: 'ticket_reply', inApp: 'yes', email: false }).success).toBe(false)
  })
})

describe('email delivery', () => {
  it('no email provider is connected yet', () => {
    expect(getEmailSender({} as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(getEmailSender({ EMAIL_PROVIDER: 'anything' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  function fakeOutbox(queue: { id: number; attempts: number }[], unrenderable: number[] = []) {
    const marks: { id: number; status: string; error?: string }[] = []
    const outbox: Outbox = {
      take: async (limit) => queue.slice(0, limit),
      render: async (id) => (unrenderable.includes(id) ? null : { to: `p${id}@uni.example`, subject: `S${id}`, text: `T${id}` }),
      mark: async (id, r) => void marks.push({ id, ...r }),
    }
    return { outbox, marks }
  }

  it('sends what renders, skips what can no longer be sent, and keeps failures queued until the fifth attempt', async () => {
    const sent: string[] = []
    const sender: EmailSender = {
      id: 'fake',
      send: async (m) => {
        if (m.to.startsWith('p3') || m.to.startsWith('p4')) throw new Error('mailbox unavailable')
        sent.push(m.to)
      },
    }
    const { outbox, marks } = fakeOutbox(
      [
        { id: 1, attempts: 0 },
        { id: 2, attempts: 0 },
        { id: 3, attempts: 1 },
        { id: 4, attempts: 4 },
      ],
      [2],
    )
    expect(await deliverQueued(outbox, sender)).toEqual({ sent: 1, failed: 1, skipped: 1, retrying: 1 })
    expect(sent).toEqual(['p1@uni.example'])
    expect(marks).toEqual([
      { id: 1, status: 'sent' },
      { id: 2, status: 'skipped' },
      { id: 3, status: 'queued', error: 'mailbox unavailable' },
      { id: 4, status: 'failed', error: 'mailbox unavailable' },
    ])
  })

  it('takes at most the limit', async () => {
    const { outbox, marks } = fakeOutbox(Array.from({ length: 10 }, (_, i) => ({ id: i + 1, attempts: 0 })))
    await deliverQueued(outbox, { id: 'fake', send: async () => undefined }, 3)
    expect(marks).toHaveLength(3)
  })
})
