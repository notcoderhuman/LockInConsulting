import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ATTEMPT_MARKER, logBoot, remoteOwners, runBootMigration, verifySchemaObjects } from '@/lib/db/boot-migrate.mjs'
import { migrate } from '../scripts/migrate.mjs'

describe('boot migrations', () => {
  it('accepts local owners and refuses an owner tied to a remote IP', () => {
    expect(remoteOwners(['u_app@localhost', 'u_app@127.0.0.1', 'u_app@%'])).toEqual([])
    expect(remoteOwners(['u_app@localhost', 'u_app@223.233.73.10'])).toEqual(['u_app@223.233.73.10'])
  })

  it('refuses a schema with a missing trigger', async () => {
    const connection = { query: vi.fn(async () => [[{ n: 13 }]]) }
    await expect(verifySchemaObjects(connection)).rejects.toThrow('Expected 14 triggers, found 13')
  })

  it('refuses a schema owned by a remote user', async () => {
    const query = vi.fn().mockResolvedValueOnce([[{ n: 14 }]]).mockResolvedValueOnce([[{ d: 'u_app@223.233.73.10' }]])
    await expect(verifySchemaObjects({ query })).rejects.toThrow('remote user')
  })

  it('allows one attempt per deployment: a marker left by a failed run blocks any retry without touching the database', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'lockin-boot-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as unknown as typeof setInterval)
    const createConnection = vi.fn()
    writeFileSync(path.join(directory, ATTEMPT_MARKER), 'earlier')
    const settled = vi.fn()
    void runBootMigration({ createConnection } as unknown as Parameters<typeof runBootMigration>[0], directory).then(settled)
    await new Promise((r) => setImmediate(r))
    expect(settled).not.toHaveBeenCalled()
    expect(createConnection).not.toHaveBeenCalled()
    expect(log.mock.calls.join()).toContain('did not finish')
    rmSync(directory, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('stays closed instead of exiting when a migration fails, and keeps the marker', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'lockin-boot-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit')
    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as unknown as typeof setInterval)
    vi.stubEnv('DATABASE_URL', 'mysql://user:secret-password@127.0.0.1:3306/db')
    const createConnection = vi.fn(async () => {
      throw new Error('refused')
    })
    const settled = vi.fn()
    void runBootMigration({ createConnection } as unknown as Parameters<typeof runBootMigration>[0], directory).then(settled)
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    expect(existsSync(path.join(directory, ATTEMPT_MARKER))).toBe(true)
    expect(log.mock.calls.join()).toContain('refused')
    expect(log.mock.calls.join()).not.toContain('secret-password')
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('writes the JSON line Hostinger keeps', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    logBoot('INFO', 'hello')
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ level: 'INFO', message: '[migrate] hello', timestamp: expect.any(String) })
    log.mockRestore()
  })

  it('re-reads what is pending after taking the lock, so a racing run applies nothing twice', async () => {
    const migration = { name: '0001_a.sql', checksum: 'a'.repeat(64), sql: 'CREATE TABLE a (id INT)' }
    const statements: string[] = []
    let reads = 0
    const connection = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.startsWith('SELECT name, checksum')) {
          reads += 1
          // The other process finished between this run's first read and its lock.
          return [reads === 1 ? [] : [{ name: migration.name, checksum: migration.checksum }]]
        }
        if (sql.includes('GET_LOCK')) return [[{ got: 1 }]]
        return [[]]
      }),
    }
    expect(await migrate(connection as unknown as Parameters<typeof migrate>[0], [migration])).toEqual([])
    expect(statements).not.toContain(migration.sql)
    expect(statements.at(-1)).toContain('RELEASE_LOCK')
  })
})
