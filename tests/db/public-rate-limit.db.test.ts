// Shared, persistent request limits for the public university endpoints, against a real database.
// Counts are atomic across connections (standing in for several Node processes) and reset per window.
import mysql, { type Connection, type Pool, type RowDataPacket } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

const { hit, limitPublicRequest, PUBLIC_LIMITS, WINDOW_MS } = await import('@/lib/public-rate-limit')
const { pruneStaleRows } = await import('@/lib/auth-throttle')

let server: TestDatabase
let db: Connection
let pool: Pool
const T0 = 1_800_000_000_000 // a window boundary (divisible by 60 000)

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  pool = mysql.createPool({ uri: server.url, connectionLimit: 8 })
}, 240_000)

afterEach(async () => {
  vi.unstubAllEnvs()
  await db.query("DELETE FROM auth_rate_limit WHERE `key` LIKE 'public:%' OR `key` LIKE 'test:%'")
})

afterAll(async () => {
  await pool?.end()
  await db?.end()
  await server?.stop()
})

const request = (ip?: string) => new Request('http://x/api/universities/search', { headers: ip ? { 'x-real-ip': ip } : {} })

describe('public request limiter', () => {
  it('counts per key and window, and starts again in the next window', async () => {
    expect(await hit(db, 'test:a', T0)).toBe(1)
    expect(await hit(db, 'test:a', T0 + 10)).toBe(2)
    expect(await hit(db, 'test:b', T0 + 20)).toBe(1)
    expect(await hit(db, 'test:a', T0 + WINDOW_MS)).toBe(1)
    expect(await hit(db, 'test:a', T0 + WINDOW_MS + 1)).toBe(2)
  })

  it('stays exact under concurrent requests from many connections', async () => {
    const counts = await Promise.all(Array.from({ length: 40 }, () => hit(pool, 'test:concurrent', T0)))
    expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
  })

  it('limits each client once a trusted IP header is configured, with Retry-After', async () => {
    vi.stubEnv('AUTH_CLIENT_IP_HEADER', 'x-real-ip')
    for (let i = 0; i < PUBLIC_LIMITS.search.perClient; i++) expect(await limitPublicRequest(request('203.0.113.7'), 'search', db, T0 + 15_000)).toBeNull()
    const refused = await limitPublicRequest(request('203.0.113.7'), 'search', db, T0 + 15_000)
    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('Retry-After')).toBe('45')
    // Another client, and the lookup endpoint, have their own budgets.
    expect(await limitPublicRequest(request('198.51.100.1'), 'search', db, T0 + 15_000)).toBeNull()
    expect(await limitPublicRequest(request('203.0.113.7'), 'lookup', db, T0 + 15_000)).toBeNull()
  })

  it('without a trusted header ignores client-supplied IPs and applies only the site-wide ceiling', async () => {
    for (let i = 0; i < PUBLIC_LIMITS.lookup.global; i++) await hit(db, 'public:lookup:global', T0)
    expect((await limitPublicRequest(request('203.0.113.9'), 'lookup', db, T0))?.status).toBe(429)
    const [rows] = await db.query<RowDataPacket[]>("SELECT `key` FROM auth_rate_limit WHERE `key` LIKE 'public:%:ip:%'")
    expect(rows).toEqual([])
  })

  it('never stores a malformed IP header as a key', async () => {
    vi.stubEnv('AUTH_CLIENT_IP_HEADER', 'x-real-ip')
    expect(await limitPublicRequest(request("1.2.3.4'; DROP TABLE x"), 'search', db, T0)).toBeNull()
    const [rows] = await db.query<RowDataPacket[]>("SELECT `key` FROM auth_rate_limit WHERE `key` LIKE 'public:search:ip:%'")
    expect(rows).toEqual([])
  })

  it('answers 503 rather than letting requests through when the limiter cannot write', async () => {
    const broken = { query: () => Promise.reject(new Error('down')) }
    expect((await limitPublicRequest(request(), 'search', broken, T0))?.status).toBe(503)
  })

  it('is cleared by the existing sign-in throttle cleanup once idle', async () => {
    await hit(db, 'public:search:global', T0)
    await pruneStaleRows(db, T0 + 2 * 60 * 60 * 1000)
    const [rows] = await db.query<RowDataPacket[]>("SELECT `key` FROM auth_rate_limit WHERE `key` = 'public:search:global'")
    expect(rows).toEqual([])
  })
})
