import type { NextConfig } from 'next'
import { buildContentSecurityPolicy, buildSecurityHeaders, STATIC_CSP_SOURCE } from './src/lib/security/headers'

const isDev = process.env.NODE_ENV !== 'production'

const securityOptions = { isDev, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) }

const nextConfig: NextConfig = {
  // Next.js 16 defaults (see ADR-006): static shells + streaming, partial prefetching.
  cacheComponents: true,
  partialPrefetching: true,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Root layout lives under app/[lang], so unmatched URLs need a global 404.
    globalNotFound: true,
    // Logo uploads (≤ 1 MB, checked again in the action and by the storage bucket).
    serverActions: { bodySizeLimit: '2mb' },
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders(securityOptions),
      },
      {
        // Signed-in app and platform pages get a per-request nonce policy from the proxy instead.
        source: STATIC_CSP_SOURCE,
        headers: [{ key: 'Content-Security-Policy', value: buildContentSecurityPolicy(securityOptions) }],
      },
    ]
  },
}

export default nextConfig
