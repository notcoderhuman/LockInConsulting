// Applies db/migrations/*.sql in filename order, once each, recording a SHA-256 checksum.
// Refuses to continue if an already-applied file has been edited — add a new migration instead.
//
// Usage: DATABASE_URL=mysql://user:pass@host:3306/db node scripts/migrate.mjs
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

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
  const ran = []

  for (const m of migrations) {
    const previous = applied.get(m.name)
    if (previous) {
      if (previous !== m.checksum) {
        throw new Error(`Migration ${m.name} was modified after being applied. Create a new migration instead.`)
      }
      continue
    }
    // MySQL DDL auto-commits, so a failed migration can leave partial tables. Run against a
    // backup first in production (documented in README).
    await connection.query(m.sql)
    await connection.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [m.name, m.checksum])
    ran.push(m.name)
  }
  return ran
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
  } finally {
    await connection.end()
  }
}
