// Applies db/migrations/*.sql in filename order, once each, recording a SHA-256 checksum.
// Refuses to continue if an already-applied file has been edited — add a new migration instead.
//
// Usage: DATABASE_URL=mysql://user:pass@host:3306/db node scripts/migrate.mjs
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { describeServer, probeAdvice, probeDdlCapabilities } from './db-capabilities.mjs'

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

export async function loadMigrations(dir = MIGRATIONS_DIR) {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(dir, name), 'utf8')
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
    }),
  )
}

/**
 * @param {import('mysql2/promise').Connection} connection — must be opened with multipleStatements: true
 * @returns {Promise<string[]>} names of migrations applied in this run
 */
export async function migrate(connection, migrations) {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(191) NOT NULL PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`)

  const [rows] = await connection.query('SELECT name, checksum FROM schema_migrations')
  const applied = new Map(rows.map((r) => [r.name, r.checksum]))
  const pending = []
  for (const m of migrations) {
    const previous = applied.get(m.name)
    if (!previous) pending.push(m)
    else if (previous !== m.checksum)
      throw new Error(`Migration ${m.name} was modified after being applied. Create a new migration instead.`)
  }
  if (!pending.length) return []

  const [lockRows] = await connection.query("SELECT GET_LOCK('lockin_schema_migrate', 0) AS got")
  if (Number(lockRows[0]?.got) !== 1) throw new Error('Another migration run holds the lock. Wait for it to finish.')
  try {
    // DDL auto-commits, so prove every required feature works for this user BEFORE changing
    // anything, rather than discovering a refused CREATE TRIGGER halfway through 0002.
    const probe = await probeDdlCapabilities(connection)
    if (!probe.ok) {
      const failed = probe.steps.filter((s) => !s.ok).map((s) => `${s.name}${s.detail ? ` (${s.detail})` : ''}`)
      const advice = probeAdvice(await describeServer(connection))
      throw new Error(`Database capability check failed; no migration was applied. ${[...failed, ...advice].join(' | ')}`)
    }

    const ran = []
    for (const m of pending) {
      try {
        await connection.query(m.sql)
      } catch (e) {
        throw new Error(
          `Migration ${m.name} failed partway: ${e?.code ?? ''} ${e?.sqlMessage ?? e?.message ?? e}. DDL auto-commits, so the schema may be partially changed. ` +
            'It was NOT recorded in schema_migrations, so /admin stays unavailable (fails closed). Restore the pre-migration backup before retrying.',
        )
      }
      await connection.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [m.name, m.checksum])
      ran.push(m.name)
    }
    return ran
  } finally {
    await connection.query("SELECT RELEASE_LOCK('lockin_schema_migrate')").catch(() => {})
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCli) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set.')
    process.exit(1)
  }
  const connection = await mysql.createConnection({ uri: url, multipleStatements: true })
  try {
    const ran = await migrate(connection, await loadMigrations())
    console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.')
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await connection.end()
  }
}
