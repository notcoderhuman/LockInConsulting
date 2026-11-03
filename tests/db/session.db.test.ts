// Hostinger's server default sql_mode is not strict. A local server's default is, so the control
// below forces a non-strict session first: the test then means the same thing on every engine.
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SESSION_SETUP } from '../../lib/db/session.mjs'
import { startTestDatabase, type TestDatabase } from './harness'

const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')

let server: TestDatabase
let plain: Connection

const sessionMode = async (c: { query: Connection['query'] }) => {
  const [[row]] = await c.query<RowDataPacket[]>('SELECT @@SESSION.sql_mode AS mode, @@SESSION.time_zone AS tz')
  return { mode: String(row.mode), tz: String(row.tz) }
}

beforeAll(async () => {
  server = await startTestDatabase()
  process.env.DATABASE_URL = server.url
  plain = await mysql.createConnection({ uri: server.url })
}, 240_000)

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await plain?.end()
  await server?.stop()
})

describe('strict session mode', () => {
  it('turns a non-strict session strict: over-long text is refused instead of silently cut', async () => {
    await plain.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'")
    await plain.query('CREATE TEMPORARY TABLE strict_check (id INT PRIMARY KEY, label VARCHAR(3), day DATE)')

    await plain.query("INSERT INTO strict_check (id, label) VALUES (1, 'too long')")
    const [[cut]] = await plain.query<RowDataPacket[]>('SELECT label FROM strict_check WHERE id = 1')
    expect(cut.label).toBe('too')

    await plain.query(SESSION_SETUP)
    expect((await sessionMode(plain)).mode).toContain('STRICT_TRANS_TABLES')
    await expect(plain.query("INSERT INTO strict_check (id, label) VALUES (2, 'too long')")).rejects.toThrow(/too long/i)
    await expect(plain.query("INSERT INTO strict_check (id, day) VALUES (3, '0000-00-00')")).rejects.toThrow(/incorrect date/i)
    const [rows] = await plain.query<RowDataPacket[]>('SELECT id FROM strict_check')
    expect(rows.map((r) => r.id)).toEqual([1])
    await plain.query('DROP TEMPORARY TABLE strict_check')
  })

  it('keeps the modes the session already had', async () => {
    await plain.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'")
    await plain.query(SESSION_SETUP)
    expect((await sessionMode(plain)).mode).toContain('NO_ENGINE_SUBSTITUTION')
  })

  it('works from an empty sql_mode', async () => {
    await plain.query("SET SESSION sql_mode = ''")
    await plain.query(SESSION_SETUP)
    expect((await sessionMode(plain)).mode).toContain('STRICT_TRANS_TABLES')
  })

  it('every connection in every app pool is strict and UTC, including parallel ones', async () => {
    for (const pool of [getPool(), getAdminPool(), getAuthPool()]) {
      const sessions = await Promise.all([1, 2, 3, 4, 5].map(() => sessionMode(pool)))
      for (const s of sessions) {
        expect(s.mode).toContain('STRICT_TRANS_TABLES')
        expect(s.mode).toContain('NO_ZERO_DATE')
        expect(s.tz).toBe('+00:00')
      }
    }
  })
})
