// Starts a disposable database for the integration suites.
//
// Default: a throwaway MySQL 8.4 server (mysql-memory-server; needs libaio + libnuma on Linux).
// Target-engine check: set DB_TEST_URL to a server running the real target engine/version
// (e.g. the Hostinger plan's MySQL or MariaDB, or a local container of the same version):
//   DB_TEST_URL=mysql://user:pass@host:3306/scratch pnpm test:db
// The suite then creates a uniquely named database and drops it afterwards. If the user can't
// CREATE DATABASE (common on shared hosting), the URL's database is used only if it is EMPTY,
// and every table/view the suite created is dropped at the end. It never touches a database
// that already contains tables, so it can't be pointed at production data by mistake.
import { randomBytes } from 'node:crypto'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import { createDB } from 'mysql-memory-server'

export interface TestDatabase {
  url: string
  engine: string
  stop: () => Promise<void>
}

function withDatabase(url: URL, name: string): string {
  const u = new URL(url.toString())
  u.pathname = `/${name}`
  return u.toString()
}

async function dropEverything(conn: Connection) {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0')
  const [views] = await conn.query<RowDataPacket[]>("SELECT TABLE_NAME AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()")
  for (const v of views) await conn.query(`DROP VIEW IF EXISTS \`${v.n}\``)
  const [tables] = await conn.query<RowDataPacket[]>("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")
  for (const t of tables) await conn.query(`DROP TABLE IF EXISTS \`${t.n}\``)
  await conn.query('SET FOREIGN_KEY_CHECKS = 1')
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const external = process.env.DB_TEST_URL
  if (!external) {
    const server = await createDB({ version: '8.4.x', logLevel: 'ERROR' })
    const url = `mysql://${server.username}@127.0.0.1:${server.port}/${server.dbName}`
    const conn = await mysql.createConnection({ uri: url })
    const [[v]] = await conn.query<RowDataPacket[]>('SELECT VERSION() AS v')
    await conn.end()
    return { url, engine: `MySQL ${v.v} (mysql-memory-server)`, stop: () => server.stop() }
  }

  const base = new URL(external)
  const admin = await mysql.createConnection({ uri: external, multipleStatements: false })
  const [[v]] = await admin.query<RowDataPacket[]>('SELECT VERSION() AS v')
  const engine = `${/mariadb/i.test(String(v.v)) ? 'MariaDB' : 'MySQL'} ${v.v} (DB_TEST_URL)`
  const scratch = `lockin_test_${randomBytes(4).toString('hex')}`
  try {
    await admin.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await admin.end()
    return {
      url: withDatabase(base, scratch),
      engine,
      stop: async () => {
        const c = await mysql.createConnection({ uri: external })
        await c.query(`DROP DATABASE IF EXISTS \`${scratch}\``)
        await c.end()
      },
    }
  } catch {
    const [[count]] = await admin.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')
    if (Number(count.n) > 0) {
      await admin.end()
      throw new Error('DB_TEST_URL points at a database that already has tables. Use an empty, dedicated test database.')
    }
    await admin.end()
    return {
      url: external,
      engine: `${engine}, existing empty database`,
      stop: async () => {
        const c = await mysql.createConnection({ uri: external })
        await dropEverything(c)
        await c.end()
      },
    }
  }
}

export async function connect(url: string): Promise<Connection> {
  const conn = await mysql.createConnection({ uri: url, multipleStatements: true, dateStrings: true, timezone: 'Z' })
  await conn.query("SET time_zone = '+00:00'")
  return conn
}
