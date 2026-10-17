import { describe, expect, it } from 'vitest'
import { buildCsp, createNonce, cspHeaderName, resolveCspMode } from '@/lib/security/csp'

function directives(policy: string) {
  return Object.fromEntries(
    policy.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/)
      return [name, values]
    }),
  )
}

describe('content security policy', () => {
  it('enforces by default and only reports when explicitly asked', () => {
    expect(resolveCspMode({})).toBe('enforce')
    expect(resolveCspMode({ CSP_MODE: 'off' })).toBe('enforce')
    expect(resolveCspMode({ CSP_MODE: 'report-only' })).toBe('report-only')
    expect(cspHeaderName('enforce')).toBe('Content-Security-Policy')
  })

  it('generates unpredictable nonces', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce))
    expect(nonces.size).toBe(50)
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })

  it('production policy allows no inline or eval script and no third-party origin', () => {
    const d = directives(buildCsp('abc'))
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"])
    expect(d['style-src']).toEqual(["'self'", "'nonce-abc'"])
    expect(d['connect-src']).toEqual(["'self'"])
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['frame-ancestors']).toEqual(["'self'"])
    expect(d).toHaveProperty('upgrade-insecure-requests')
    const all = Object.values(d).flat().join(' ')
    expect(all).not.toMatch(/unsafe-eval|https?:|\*/)
    expect(d['script-src'].join(' ')).not.toContain('unsafe-inline')
  })

  it('only development relaxes eval and websockets', () => {
    const d = directives(buildCsp('abc', { isDev: true }))
    expect(d['script-src']).toContain("'unsafe-eval'")
    expect(d['connect-src']).toEqual(["'self'", 'ws:', 'wss:'])
  })
})
