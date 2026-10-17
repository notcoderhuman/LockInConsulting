import mysql, { type Pool, type PoolOptions } from 'mysql2/promise'

let pool: Pool | undefined
let adminPool: Pool | undefined
let authPool: Pool | undefined

// Every connection runs in UTC so CURDATE() in the public_* views agrees with todayIso() and
// Better Auth's TIMESTAMP columns round-trip without a server-timezone shift. An offset is used
// instead of a named zone because shared hosts often lack the MySQL time-zone tables.
function createUtcPool(options: PoolOptions): Pool {
  const created = mysql.createPool({ ...options, multipleStatements: false, timezone: 'Z' })
  created.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'")
  })
  return created
}

/** Public read path. The DB user should only need SELECT on public_* views. */
export function getPool(): Pool {
  const uri = process.env.DATABASE_URL
  if (!uri) throw new Error('DATABASE_URL is not set')
  pool ??= createUtcPool({ uri, dateStrings: true, connectionLimit: 5 })
  return pool
}

/** Admin data writes. Can use a separate, more privileged DB user via ADMIN_DATABASE_URL. */
export function getAdminPool(): Pool {
  const uri = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL
  if (!uri) throw new Error('ADMIN_DATABASE_URL / DATABASE_URL is not set')
  adminPool ??= createUtcPool({ uri, dateStrings: true, connectionLimit: 5 })
  return adminPool
}

/** Better Auth needs real Date objects, so this pool doesn't use dateStrings. */
export function getAuthPool(): Pool {
  const uri = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL
  if (!uri) throw new Error('ADMIN_DATABASE_URL / DATABASE_URL is not set')
  authPool ??= createUtcPool({ uri, connectionLimit: 5 })
  return authPool
}
