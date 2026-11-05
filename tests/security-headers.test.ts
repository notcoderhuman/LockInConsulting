// RISKS.md R-030: commit da5b14c removed X-Frame-Options and Cross-Origin-Opener-Policy.
// These are applied to every route by next.config.mjs (the CSP is added per request in proxy.ts).
import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config.mjs'

describe('static security headers', () => {
  it('applies the full header set to every path', async () => {
    const rules = await nextConfig.headers!()
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('/:path*')
    const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))
    expect(headers).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=63072000',
      'X-Frame-Options': 'SAMEORIGIN',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    })
    expect(nextConfig.poweredByHeader).toBe(false)
  })
})

describe('canonical origin', () => {
  it('sends every www.<host> request permanently to <host>, keeping the path, and nothing else', async () => {
    const rules = await nextConfig.redirects!()
    expect(rules).toHaveLength(1)
    const [rule] = rules
    expect(rule).toMatchObject({ source: '/:path*', destination: 'https://:apex/:path*', permanent: true })
    const host = rule.has?.find((h) => h.type === 'host')
    // Next matches `has` values as a full-string regex.
    const re = new RegExp(`^${host?.value}$`)
    expect(re.exec('www.lockin.example')?.groups?.apex).toBe('lockin.example')
    for (const h of ['lockin.example', 'localhost', 'staging.lockin.example', 'wwwlockin.example']) expect(re.test(h), h).toBe(false)
  })
})
