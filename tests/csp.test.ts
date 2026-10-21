import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

// R-030: development allows `frame-ancestors *` for preview iframes. It must never reach a
// non-development response. (A production build also constant-folds isDev to false in proxy.ts.)
describe('proxy response CSP', () => {
  afterEach(() => vi.unstubAllEnvs())

  async function responsePolicy(nodeEnv: string) {
    vi.stubEnv('NODE_ENV', nodeEnv)
    vi.stubEnv('CSP_MODE', '')
    const { proxy } = await import('../proxy')
    const res = proxy(new NextRequest('https://lockin.example/destinations/uk'))
    return { header: res.headers.get('content-security-policy'), forwarded: res.headers.get('x-middleware-request-content-security-policy') }
  }

  it.each(['production', 'test', ''])('NODE_ENV=%j: frame-ancestors is self only, with a fresh nonce', async (env) => {
    const a = await responsePolicy(env)
    const b = await responsePolicy(env)
    expect(a.header).toBeTruthy()
    const d = directives(a.header!)
    expect(d['frame-ancestors']).toEqual(["'self'"])
    expect(a.header).not.toMatch(/\*|unsafe-eval/)
    expect(a.forwarded).toBe(a.header) // the same nonce Next stamps on its own scripts
    expect(d['script-src'][1]).toMatch(/^'nonce-[A-Za-z0-9+/]{22}=='$/)
    expect(a.header).not.toBe(b.header)
  })

  it('NODE_ENV=development is the only case that allows framing by any origin', async () => {
    expect(directives((await responsePolicy('development')).header!)['frame-ancestors']).toEqual(["'self'", '*'])
  })
})
