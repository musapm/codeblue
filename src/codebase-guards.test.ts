import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static guards for project rules that are easy to break by accident.
 * See docs/architecture.md §6 (branding) and docs/security.md (secrets).
 */

const ROOT = join(__dirname)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const files = sourceFiles(ROOT).map((path) => ({ path: relative(ROOT, path), content: readFileSync(path, 'utf8') }))

describe('codebase guards', () => {
  it('the product name is defined only in platform branding config', () => {
    // Case-sensitive on purpose: the display name must come from platformBranding.name.
    // Internal identifiers (UNIAGENT_* env keys, the "uniagent-web" log service) are a
    // stable codename that is never shown to users and survives a product rename.
    const offenders = files.filter((f) => f.path !== join('lib', 'branding', 'platform.ts') && /UniAgent/.test(f.content)).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('client components never read server-only environment variables', () => {
    const offenders = files
      .filter((f) => /^['"]use client['"]/m.test(f.content))
      .filter((f) => /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV)/.test(f.content))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('server-only modules are marked with `server-only`', () => {
    const mustBeServerOnly = [
      join('lib', 'env', 'server.ts'),
      join('lib', 'supabase', 'server.ts'),
      join('lib', 'auth', 'session.ts'),
      join('lib', 'tenancy', 'context.ts'),
      join('lib', 'system', 'readiness.ts'),
    ]
    for (const path of mustBeServerOnly) {
      const file = files.find((f) => f.path === path)
      expect(file, path).toBeDefined()
      expect(file!.content, path).toMatch(/^import 'server-only'/m)
    }
  })

  it('no module uses the Supabase secret key outside the (future) admin client', () => {
    const offenders = files
      .filter((f) => /SUPABASE_SECRET_KEY|service_role/i.test(f.content))
      .map((f) => f.path)
      .filter((path) => ![join('lib', 'env', 'server.ts'), join('lib', 'system', 'readiness.ts')].includes(path))
    expect(offenders).toEqual([])
  })
})
