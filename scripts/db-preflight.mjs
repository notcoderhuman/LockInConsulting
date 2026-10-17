// Read-only compatibility report for a staging (or production) database, run BEFORE migrations.
//
//   PREFLIGHT_DATABASE_URL=mysql://user:pass@host:3306/db node scripts/db-preflight.mjs [--probe]
//   (falls back to ADMIN_DATABASE_URL, then DATABASE_URL)
//
// Without --probe it only runs SELECT / SHOW statements. With --probe it also creates and drops a
// uniquely named _lockin_probe_* table, view and trigger to prove CHECK constraints, generated
// columns, views and SIGNAL triggers work for this user. It never touches existing objects and
// never prints the connection URL, passwords or password hashes.
// Exit code: 0 = no blockers, 1 = blockers found, 2 = could not connect / bad usage.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import mysql from 'mysql2/promise'
import { classifyVersion, describeServer, probeAdvice, probeDdlCapabilities, redactGrant } from './db-capabilities.mjs'
import { loadMigrations } from './migrate.mjs'

export async function runPreflight(conn, { probe = false } = {}) {
  const blockers = []
  const warnings = []
  const server = await describeServer(conn)
  const version = classifyVersion(server.version)

  if (!server.databaseName) blockers.push('The connection URL does not select a database.')
  if (!version.supported) blockers.push(`${version.label} is not supported (need MySQL >= 8.0.19 or MariaDB >= 10.5).`)
  else if (!version.tested) warnings.push(`${version.label} is supported in principle but untested: run "pnpm test:db" with DB_TEST_URL against this exact version.`)
  if (!/STRICT_(TRANS|ALL)_TABLES/.test(server.sqlMode))
    warnings.push('sql_mode is not strict. The CHECK constraints still apply, but non-strict mode can silently truncate over-long text.')
  if (server.logBin && !server.trustFunctionCreators)
    warnings.push('Binary logging is on and log_bin_trust_function_creators is off: CREATE TRIGGER will need SUPER. Run with --probe to confirm.')
  if (server.storageEngine.toUpperCase() !== 'INNODB') warnings.push(`Default storage engine is ${server.storageEngine}; migrations request InnoDB explicitly.`)

  const [grantRows] = await conn.query('SHOW GRANTS')
  const grants = /** @type {any[]} */ (grantRows).map((r) => redactGrant(Object.values(r)[0]))
  const grantText = grants.join('\n').toUpperCase()
  const hasAll = /ALL PRIVILEGES/.test(grantText)
  for (const priv of ['CREATE VIEW', 'TRIGGER', 'ALTER', 'REFERENCES', 'INDEX']) {
    if (!hasAll && !grantText.includes(priv)) warnings.push(`SHOW GRANTS does not list ${priv} (it may be inherited through a role; --probe confirms).`)
  }

  const [tableRows] = await conn.query(
    "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  )
  const objects = /** @type {any[]} */ (tableRows)
  let applied = []
  if (objects.some((o) => o.name === 'schema_migrations')) {
    const [m] = await conn.query('SELECT name FROM schema_migrations ORDER BY name')
    applied = /** @type {any[]} */ (m).map((r) => String(r.name))
  }
  const expected = (await loadMigrations()).map((m) => m.name)
  const pending = expected.filter((n) => !applied.includes(n))
  const unexpected = objects.filter((o) => o.name !== 'schema_migrations').length
  if (applied.length === 0 && unexpected > 0)
    blockers.push(`The database has ${unexpected} tables/views but no migration history. Use an empty, dedicated database.`)
  if (applied.length > 0 && pending.length > 0 && objects.some((o) => o.name === 'auth_user') && !applied.includes('0002_admin_auth.sql'))
    blockers.push('0002 objects exist but 0002 is not recorded: a previous migration failed partway. Restore the backup before retrying.')

  let probeResult = null
  if (probe) {
    probeResult = await probeDdlCapabilities(conn)
    if (!probeResult.ok) blockers.push('The DDL capability probe failed (see steps). Migrations would fail or leave the schema half-applied.')
    for (const a of probeAdvice(server)) if (!probeResult.ok) blockers.push(a)
  }

  return { server, version, grants, objectCount: objects.length, applied, pending, probe: probeResult, warnings, blockers }
}

function print(report, log) {
  const s = report.server
  log(`Engine:            ${report.version.label} (${report.version.tested ? 'tested' : report.version.supported ? 'supported, untested' : 'UNSUPPORTED'})`)
  log(`Raw version:       ${s.version}`)
  log(`Database / user:   ${s.databaseName ?? '(none)'} / ${s.currentUser}`)
  log(`sql_mode:          ${s.sqlMode || '(empty)'}`)
  log(`Global time zone:  ${s.globalTimeZone} (the app sets +00:00 per connection)`)
  log(`Binary logging:    ${s.logBin ? 'on' : 'off'}; log_bin_trust_function_creators=${s.trustFunctionCreators ? 1 : 0}`)
  log(`Charset/collation: ${s.charset} / ${s.collation}; lower_case_table_names=${s.lowerCaseTableNames}`)
  log(`Objects in schema: ${report.objectCount}`)
  log(`Migrations:        applied [${report.applied.join(', ') || 'none'}]; pending [${report.pending.join(', ') || 'none'}]`)
  log('Grants (redacted):')
  for (const g of report.grants) log(`  ${g}`)
  if (report.probe) {
    log('DDL probe:')
    for (const st of report.probe.steps) log(`  [${st.ok ? 'ok' : 'FAIL'}] ${st.name}${st.detail ? ` — ${st.detail}` : ''}`)
  } else log('DDL probe:         not run (pass --probe)')
  for (const w of report.warnings) log(`WARNING: ${w}`)
  for (const b of report.blockers) log(`BLOCKER: ${b}`)
  log(report.blockers.length ? 'Result: NOT READY' : 'Result: no blockers found')
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const { values } = parseArgs({ options: { probe: { type: 'boolean', default: false } } })
  const uri = process.env.PREFLIGHT_DATABASE_URL || process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL
  if (!uri) {
    console.error('Set PREFLIGHT_DATABASE_URL (or ADMIN_DATABASE_URL / DATABASE_URL).')
    process.exit(2)
  }
  let conn
  try {
    conn = await mysql.createConnection({ uri, multipleStatements: false })
  } catch (e) {
    console.error(`Could not connect: ${/** @type {any} */ (e).code ?? 'error'}`)
    process.exit(2)
  }
  try {
    const report = await runPreflight(conn, { probe: values.probe })
    print(report, (s) => console.log(s))
    process.exitCode = report.blockers.length ? 1 : 0
  } finally {
    await conn.end()
  }
}
