import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('allows one attempt per deployment: a marker left by an unfinished run blocks any retry and changes nothing', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'lockin-boot-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as unknown as typeof setInterval)
    const createConnection = vi.fn()
    writeFileSync(path.join(directory, ATTEMPT_MARKER), 'earlier')
    const settled = vi.fn()
    void runBootMigration({ createConnection } as unknown as Parameters<typeof runBootMigration>[0], directory).then(settled)
    await new Promise((r) => setImmediate(r))
    expect(settled).not.toHaveBeenCalled()
    // No database URL: the completeness check cannot even connect, so it stays closed.
    expect(createConnection).not.toHaveBeenCalled()
    expect(existsSync(path.join(directory, ATTEMPT_MARKER))).toBe(true)
    expect(log.mock.calls.join()).toContain('did not finish')
    rmSync(directory, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  // Hostinger restarted the app several times within a second (5 Nov 2026) and killed a finished run
  // before it removed its marker. A stale marker may be cleared only when the database proves completion.
  describe('marker left by a run that was killed after finishing', () => {
    const migration = { name: '0001_a.sql', sql: 'CREATE TABLE a (id INT)' }
    const checksum = createHash('sha256').update(migration.sql).digest('hex')
    function setup(recorded: { name: string; checksum: string }[], triggers = 14) {
      const directory = mkdtempSync(path.join(tmpdir(), 'lockin-boot-'))
      mkdirSync(path.join(directory, 'db', 'migrations'), { recursive: true })
      writeFileSync(path.join(directory, 'db', 'migrations', migration.name), migration.sql)
      writeFileSync(path.join(directory, ATTEMPT_MARKER), 'killed')
      vi.stubEnv('DATABASE_URL', 'mysql://user:secret-password@127.0.0.1:3306/db')
      const executed: string[] = []
      const query = vi.fn(async (sql: string) => {
        executed.push(sql)
        if (sql.startsWith('SELECT name, checksum')) return [recorded]
        if (sql.includes('information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()') && sql.startsWith('SELECT COUNT')) return [[{ n: triggers }]]
        if (sql.includes('DEFINER')) return [[{ d: 'u_app@127.0.0.1' }]]
        if (sql.includes('GET_LOCK')) return [[{ got: 1 }]]
        return [[]]
      })
      const createConnection = vi.fn(async () => ({ query, end: async () => {} }))
      return { directory, executed, createConnection }
    }
    const done = () => { vi.unstubAllEnvs(); vi.restoreAllMocks() }

    it('clears the marker and serves when every migration is recorded and the schema checks pass', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { directory, executed, createConnection } = setup([{ name: migration.name, checksum }])
      await runBootMigration({ createConnection } as unknown as Parameters<typeof runBootMigration>[0], directory)
      expect(existsSync(path.join(directory, ATTEMPT_MARKER))).toBe(false)
      expect(executed).not.toContain(migration.sql)
      expect(log.mock.calls.join()).toContain('Clearing it')
      expect(log.mock.calls.join()).toContain('Already up to date')
      expect(log.mock.calls.join()).not.toContain('secret-password')
      rmSync(directory, { recursive: true, force: true })
      done()
    })

    it('stays closed when a migration on disk is not recorded (a half-applied run is never recorded)', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as unknown as typeof setInterval)
      const { directory, executed, createConnection } = setup([])
      const settled = vi.fn()
      void runBootMigration({ createConnection } as unknown as Parameters<typeof runBootMigration>[0], directory).then(settled)
      await new Promise((r) => setTimeout(r, 20))
      expect(settled).not.toHaveBeenCalled()
      expect(existsSync(path.join(directory, ATTEMPT_MARKER))).toBe(true)
      expect(executed).not.toContain(migration.sql)
      expect(log.mock.calls.join()).toContain('did not finish')
      rmSync(directory, { recursive: true, force: true })
      done()
    })

    it('stays closed when the schema lost a trigger or a checksum differs', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as unknown as typeof setInterval)
      for (const [recorded, triggers] of [[[{ name: migration.name, checksum }], 13], [[{ name: migration.name, checksum: 'b'.repeat(64) }], 14]] as const) {
        const { directory, createConnection } = setup([...recorded], triggers)
        const settled = vi.fn()
        void runBootMigration({ createConnection } as unknown as Parameters<typeof runBootMigration>[0], directory).then(settled)
        await new Promise((r) => setTimeout(r, 20))
        expect(settled).not.toHaveBeenCalled()
        expect(existsSync(path.join(directory, ATTEMPT_MARKER))).toBe(true)
        rmSync(directory, { recursive: true, force: true })
      }
      done()
    })
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
