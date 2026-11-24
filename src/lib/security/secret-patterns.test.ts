// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { findSecrets } from './secret-patterns'

describe('secret scan patterns', () => {
  it('find real credential formats', () => {
    const fake = (prefix: string, n: number) => prefix + 'A1b2C3d4'.repeat(Math.ceil(n / 8)).slice(0, n)
    expect(findSecrets(`ANTHROPIC_API_KEY=${fake('sk-ant-api03-', 40)}`)).toEqual(['Anthropic API key'])
    expect(findSecrets(fake('sb_secret_', 30))).toEqual(['Supabase secret key'])
    expect(findSecrets('-----BEGIN PRIVATE KEY-----')).toEqual(['Private key'])
    expect(findSecrets(fake('AKIA', 16).toUpperCase())).toEqual(['AWS access key'])
    expect(findSecrets('postgres://admin:S3cretPassw0rd@db.example.com:5432/app')).toEqual(['Postgres URL with a password'])
  })

  it('leave documentation, variable names and the local test database alone', () => {
    for (const text of [
      'SUPABASE_SECRET_KEY: Service-role key for background jobs only',
      'Set ANTHROPIC_API_KEY in the environment',
      'TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres',
      'secret_ref ~ ^[A-Z][A-Z0-9_]{2,63}$',
      'sk-ant-…',
    ])
      expect(findSecrets(text), text).toEqual([])
  })
})
