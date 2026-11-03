// Applies migrations from inside the running application, for hosts with no shell (Hostinger shared
// hosting). Runs only when MIGRATE_ON_BOOT=1, from instrumentation.ts, before the server takes a
// request. The app connects over 127.0.0.1, so triggers and views are owned by the site's local
// database user, never by a remote user tied to one person's IP address.
//
// Nothing here uses a shell or logs a connection string. On any failure the server never starts
// serving, so the site stays down rather than running on a partly migrated schema.
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { SESSION_SETUP } from './session.mjs'

export const PROTECTED_TRIGGERS = 14
export const ATTEMPT_MARKER = '.migrate-attempt'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '%'])

/** Hostinger's runtime log API only keeps JSON lines with these three fields. */
export function logBoot(level, message) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message: `[migrate] ${message}` }))
}

/** @param {string[]} definers values such as user@localhost */
export function remoteOwners(definers) {
  return definers.filter((d) => !LOCAL_HOSTS.has(d.slice(d.lastIndexOf('@') + 1)))
}

/** Refuses a schema that lost a trigger, or whose objects would vanish with a temporary IP rule. */
export async function verifySchemaObjects(connection) {
  const [[{ n }]] = await connection.query('SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()')
  if (Number(n) !== PROTECTED_TRIGGERS) throw new Error(`Expected ${PROTECTED_TRIGGERS} triggers, found ${Number(n)}.`)
  const [rows] = await connection.query(
    `SELECT DISTINCT DEFINER AS d FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
     UNION SELECT DISTINCT DEFINER FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()`,
  )
  const definers = rows.map((r) => String(r.d))
  const remote = remoteOwners(definers)
  if (remote.length) throw new Error(`Objects are owned by a remote user: ${remote.join(', ')}.`)
  return definers
}

/** @param {typeof import('mysql2/promise')} mysql */
export async function migrateOnBoot(mysql, env = process.env) {
  const uri = env.ADMIN_DATABASE_URL || env.DATABASE_URL
  if (!uri) throw new Error('MIGRATE_ON_BOOT is set but no database URL is configured.')
  const connection = await mysql.createConnection({ uri, multipleStatements: true })
  try {
    await connection.query(SESSION_SETUP)
    const ran = await migrate(connection, await loadMigrations(path.join(process.cwd(), 'db', 'migrations')))
    logBoot('INFO', ran.length ? `Applied ${ran.length}: ${ran.join(', ')}` : 'Already up to date, nothing applied.')
    const definers = await verifySchemaObjects(connection)
    logBoot('INFO', `${PROTECTED_TRIGGERS} triggers present. Owners: ${definers.join(', ')}`)
  } finally {
    await connection.end()
  }
}

/**
 * Never resolves, so Next.js never starts serving. The process stays alive on purpose: exiting would
 * make the host restart it, and Hostinger offers no way to stop an application.
 */
export function holdClosed() {
  logBoot('ERROR', 'Staying closed. Not serving and not retrying. Redeploy to try again.')
  setInterval(() => {}, 3_600_000)
  return new Promise(() => {})
}

/**
 * One attempt per deployment. The marker is written first and removed only on success, so a crash, a
 * kill or a restart loop can never run a second attempt on a half-migrated database. A new
 * deployment replaces this directory, which is the deliberate way to try again.
 * @param {typeof import('mysql2/promise')} mysql
 */
export async function runBootMigration(mysql, directory = process.cwd()) {
  const marker = path.join(directory, ATTEMPT_MARKER)
  try {
    writeFileSync(marker, new Date().toISOString(), { flag: 'wx' })
  } catch (e) {
    const started = /** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST'
    logBoot('ERROR', started ? 'An earlier migration attempt did not finish.' : `Cannot record the migration attempt: ${/** @type {NodeJS.ErrnoException} */ (e).code}.`)
    await holdClosed()
  }
  try {
    await migrateOnBoot(mysql)
    rmSync(marker)
  } catch (e) {
    logBoot('ERROR', e instanceof Error ? e.message : 'Migration failed.')
    await holdClosed()
  }
}
