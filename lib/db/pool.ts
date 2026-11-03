import mysql, { type Pool, type PoolOptions } from 'mysql2/promise'
import { enforceSession } from './session.mjs'

let pool: Pool | undefined
let adminPool: Pool | undefined
let authPool: Pool | undefined

// Hostinger closes a connection after 20 s idle (wait_timeout), so idle ones are retired first and
// a request never picks one the server is closing. mysql2 ignores idleTimeout unless maxIdle is
// below connectionLimit.
function createUtcPool(options: PoolOptions & { connectionLimit: number }): Pool {
  const created = mysql.createPool({
    ...options,
    multipleStatements: false,
    timezone: 'Z',
    idleTimeout: 15_000,
    maxIdle: options.connectionLimit - 1,
  })
  enforceSession(created)
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
