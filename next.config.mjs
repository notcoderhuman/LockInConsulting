const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Content-Security-Policy is set per request in proxy.ts (it needs a fresh nonce).
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Loaded from disk at boot (instrumentation.ts), so the file tracer cannot see them.
  outputFileTracingIncludes: {
    '/*': [
      './db/migrations/**/*',
      './lib/db/boot-migrate.mjs',
      './lib/db/session.mjs',
      './scripts/migrate.mjs',
      './scripts/db-capabilities.mjs',
    ],
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
