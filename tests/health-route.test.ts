import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REQUIRED_MIGRATIONS } from '@/lib/db/schema-version'

const query = vi.fn()
vi.mock('@/lib/db/pool', () => ({ getAdminPool: () => ({ query }) }))

const { GET } = await import('@/app/api/health/route')
const applied = (names: readonly string[]) => [names.map((name) => ({ name }))]

describe('/api/health', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'mysql://user:secret-password@127.0.0.1:3306/db')
    query.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is healthy only when every required migration is recorded, and is never cached', async () => {
    query.mockResolvedValue(applied(REQUIRED_MIGRATIONS))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', database: 'ok', migrations: 'complete' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed on a partly migrated database', async () => {
    query.mockResolvedValue(applied(REQUIRED_MIGRATIONS.slice(0, -1)))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'unavailable', database: 'ok', migrations: 'incomplete' })
  })

  it('reports no configuration without touching the database', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const res = await GET()
    expect(res.status).toBe(503)
    expect(query).not.toHaveBeenCalled()
  })

  it('never exposes error text or connection details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValue(Object.assign(new Error('Access denied for mysql://user:secret-password@host'), { code: 'ER_ACCESS_DENIED_ERROR' }))
    const res = await GET()
    const text = await res.text()
    expect(res.status).toBe(503)
    expect(text).not.toContain('secret-password')
    expect(text).not.toContain('Access denied')
    expect(log.mock.calls.join()).not.toContain('secret-password')
  })
})
