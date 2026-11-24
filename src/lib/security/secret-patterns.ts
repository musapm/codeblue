/**
 * Patterns for the secret scan (Phase 16, scripts/secret-scan.mjs and its unit test). They look
 * for real credential formats, not for the word "secret": documentation may name variables.
 */
export const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase service_role JWT', pattern: /eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{20,}/ },
  { name: 'Private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Slack token', pattern: /xox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe secret key', pattern: /sk_live_[A-Za-z0-9]{20,}/ },
  { name: 'Postgres URL with a password', pattern: /postgres(?:ql)?:\/\/[^:\s/]+:(?!postgres@)[^@\s/]{6,}@(?!127\.0\.0\.1|localhost)[^\s/]+/ },
]

export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.pattern.test(text)).map((p) => p.name)
}
