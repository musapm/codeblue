#!/usr/bin/env node
/**
 * Secret scan (Phase 16): every tracked file and, with --history, every change in the git
 * history. Exits 1 and prints file and pattern names (never the matched value) on a finding.
 *   node scripts/secret-scan.mjs [--history]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/lib/security/secret-patterns.ts', import.meta.url), 'utf8')
const patterns = [...source.matchAll(/\{ name: '([^']+)', pattern: (\/.+\/[a-z]*) \}/g)].map(([, name, re]) => {
  const body = re.slice(1, re.lastIndexOf('/'))
  return { name, pattern: new RegExp(body, re.slice(re.lastIndexOf('/') + 1)) }
})
if (patterns.length < 8) throw new Error('could not read the secret patterns')

const findings = []
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
for (const file of files) {
  if (/\.(png|jpe?g|gif|webp|ico|pdf|docx|woff2?)$/i.test(file)) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const p of patterns) if (p.pattern.test(text)) findings.push(`${file}: ${p.name}`)
}

if (process.argv.includes('--history')) {
  const log = execFileSync('git', ['log', '--all', '-p', '--no-color', '--format=COMMIT %H'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })
  let commit = ''
  for (const line of log.split('\n')) {
    if (line.startsWith('COMMIT ')) commit = line.slice(7, 19)
    else if (line.startsWith('+') && !line.startsWith('+++')) for (const p of patterns) if (p.pattern.test(line)) findings.push(`history ${commit}: ${p.name}`)
  }
}

const unique = [...new Set(findings)]
if (unique.length) {
  console.error(`Secret scan: ${unique.length} finding(s)\n${unique.join('\n')}`)
  process.exit(1)
}
console.log(`Secret scan: no secrets in ${files.length} tracked files${process.argv.includes('--history') ? ' or the git history' : ''}.`)
