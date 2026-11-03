import { EventEmitter } from 'node:events'
import type { Pool } from 'mysql2/promise'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enforceSession, SESSION_SETUP } from '@/lib/db/session.mjs'

interface PoolInternals {
  pool: { config: { connectionLimit: number; maxIdle: number; idleTimeout: number } }
  end: () => Promise<void>
}

describe('session setup', () => {
  const pool = () => {
    const events = new EventEmitter()
    return { events, target: { pool: events } as unknown as Pool }
  }

  it('destroys a connection it cannot set up, so nothing runs on a non-strict session', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { events, target } = pool()
    enforceSession(target)
    const connection = { query: vi.fn((_sql: string, done: (e: Error) => void) => done(Object.assign(new Error('x'), { code: 'ER_X' }))), destroy: vi.fn() }
    events.emit('connection', connection)
    expect(connection.query).toHaveBeenCalledWith(SESSION_SETUP, expect.any(Function))
    expect(connection.destroy).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ER_X'))
    log.mockRestore()
  })

  it('keeps a connection that was set up', () => {
    const { events, target } = pool()
    enforceSession(target)
    const connection = { query: vi.fn((_sql: string, done: (e: null) => void) => done(null)), destroy: vi.fn() }
    events.emit('connection', connection)
    expect(connection.destroy).not.toHaveBeenCalled()
  })

  it('only ever touches the session, never the shared server setting', () => {
    expect(SESSION_SETUP).not.toMatch(/GLOBAL/i)
  })
})

describe('database pools and the server idle timeout', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('every pool retires idle connections before a 20-second wait_timeout', async () => {
    // No connection is opened: mysql2 connects on first use.
    vi.stubEnv('DATABASE_URL', 'mysql://user:pass@127.0.0.1:3306/none')
    const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
    for (const pool of [getPool(), getAdminPool(), getAuthPool()] as unknown as PoolInternals[]) {
      const { connectionLimit, idleTimeout, maxIdle } = pool.pool.config
      expect(idleTimeout).toBeGreaterThanOrEqual(10_000)
      expect(idleTimeout).toBeLessThanOrEqual(15_000)
      // mysql2 never starts its idle clean-up unless maxIdle is below connectionLimit.
      expect(maxIdle).toBeLessThan(connectionLimit)
      await pool.end()
    }
  })
})
