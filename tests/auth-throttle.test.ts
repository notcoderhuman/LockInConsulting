import { describe, expect, it } from 'vitest'
import { accountThrottleKey, authIpAddressOptions, clientIpHeader, issueDeviceToken, MAX_DELAY_MS, requiredDelayMs, verifyDeviceToken } from '@/lib/auth-throttle'

describe('bounded progressive delay (no hard lockout)', () => {
  it('is free for the first five failures, then doubles from 15 s and stops at 3 minutes', () => {
    expect([0, 4, 5, 6, 7, 8, 9, 50].map(requiredDelayMs)).toEqual([0, 0, 15_000, 30_000, 60_000, 120_000, 180_000, 180_000])
    expect(requiredDelayMs(10_000)).toBe(MAX_DELAY_MS)
  })
})

describe('device cookie', () => {
  const secret = 's'.repeat(40)
  const hash = 'salt-a:stored-hash-a' // stands in for the stored password hash
  it('verifies only for the same account, secret, password state, untampered value and within its lifetime', () => {
    const now = 1_800_000_000_000
    const token = issueDeviceToken('Asha@Example.com', secret, hash, now)
    expect(verifyDeviceToken(token, ' asha@example.com ', secret, hash, now + 1000)).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(verifyDeviceToken(token, 'other@example.com', secret, hash, now)).toBeNull()
    expect(verifyDeviceToken(token, 'asha@example.com', 'x'.repeat(40), hash, now)).toBeNull()
    // Change the MAC's first character: always significant (the last one is partly base64 padding).
    const at = token.lastIndexOf('.') + 1
    const tampered = `${token.slice(0, at)}${token[at] === 'A' ? 'B' : 'A'}${token.slice(at + 1)}`
    expect(verifyDeviceToken(tampered, 'asha@example.com', secret, hash, now)).toBeNull()
    expect(verifyDeviceToken(token, 'asha@example.com', secret, hash, now + 181 * 86_400_000)).toBeNull()
    for (const bad of [undefined, '', 'a.b.c', 'a.b.c.d.e']) expect(verifyDeviceToken(bad, 'asha@example.com', secret, hash, now)).toBeNull()
    expect(token).not.toContain('asha')
  })

  it('stops verifying once the password changes, and never carries password-derived data', () => {
    const token = issueDeviceToken('asha@example.com', secret, hash)
    expect(verifyDeviceToken(token, 'asha@example.com', secret, 'salt-b:stored-hash-b')).toBeNull()
    expect(verifyDeviceToken(token, 'asha@example.com', secret, null)).toBeNull()
    // The cookie is accountHash.nonce.issued.mac: none of it changes with, or reveals, the hash.
    const [account, , issued] = token.split('.')
    expect(account).toMatch(/^[0-9a-f]{64}$/)
    expect(Number(issued)).toBeGreaterThan(0)
    expect(token).not.toContain('stored-hash')
  })
})

describe('client IP trust (D2/D3)', () => {
  it('trusts no header unless one is explicitly configured', () => {
    expect(clientIpHeader({})).toBeNull()
    expect(authIpAddressOptions({})).toEqual({ disableIpTracking: true })
    expect(authIpAddressOptions({ AUTH_CLIENT_IP_HEADER: '' })).toEqual({ disableIpTracking: true })
  })

  it('uses exactly the configured header, and rejects malformed names', () => {
    expect(authIpAddressOptions({ AUTH_CLIENT_IP_HEADER: ' X-Real-IP ' })).toEqual({ ipAddressHeaders: ['x-real-ip'] })
    for (const bad of ['x-real-ip, x-forwarded-for', 'x real ip', 'x-real_ip', 'a'.repeat(65)]) expect(clientIpHeader({ AUTH_CLIENT_IP_HEADER: bad })).toBeNull()
  })

  it('keys accounts by a hash of the normalised email, never the email itself', () => {
    const key = accountThrottleKey('  Student@Example.COM ')
    expect(key).toBe(accountThrottleKey('student@example.com'))
    expect(key).toMatch(/^account:[0-9a-f]{64}\|\/sign-in\/email$/)
    expect(key).not.toContain('example')
  })
})
