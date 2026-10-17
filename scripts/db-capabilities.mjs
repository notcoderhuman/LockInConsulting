// Engine/privilege checks shared by scripts/migrate.mjs (run automatically before any pending
// migration) and scripts/db-preflight.mjs (run by hand against a new staging database).
//
// Why: MySQL/MariaDB DDL auto-commits. If a migration dies halfway (e.g. CREATE TRIGGER is refused
// because binary logging is on and the user lacks SUPER), the tables it already created stay
// behind without the triggers that protect them. Probing first means nothing is applied at all.
import { randomBytes } from 'node:crypto'

/** Engines the full integration suite has actually passed on. Anything else is "untested". */
export const TESTED_ENGINES = ['MySQL 8.4.9', 'MariaDB 10.5.29']

/** @param {string} version e.g. "8.4.9", "10.5.29-MariaDB" or "11.4.5-MariaDB-log" */
export function classifyVersion(version) {
  const isMariaDb = /mariadb/i.test(version)
  const [major = 0, minor = 0, patch = 0] = (version.match(/^(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
  const engine = isMariaDb ? 'MariaDB' : 'MySQL'
  const label = `${engine} ${major}.${minor}.${patch}`
  const atLeast = (a, b, c) => major > a || (major === a && (minor > b || (minor === b && patch >= c)))
  // MySQL < 8.0.16 parses CHECK constraints but silently ignores them; < 8.0.19 lacks
  // ALTER TABLE ... DROP CONSTRAINT. MariaDB < 10.5 is untested and end-of-life.
  const supported = isMariaDb ? atLeast(10, 5, 0) : atLeast(8, 0, 19)
  return { engine, label, supported, tested: TESTED_ENGINES.includes(label) }
}

/** @param {{ query: Function }} conn */
export async function describeServer(conn) {
  const [rows] = await conn.query(
    `SELECT VERSION() AS version, @@sql_mode AS sqlMode, @@global.time_zone AS globalTimeZone,
            @@log_bin AS logBin, @@log_bin_trust_function_creators AS trustFunctionCreators,
            @@character_set_server AS charset, @@collation_server AS collation,
            @@lower_case_table_names AS lowerCaseTableNames, @@default_storage_engine AS storageEngine,
            DATABASE() AS databaseName, CURRENT_USER() AS currentUser`,
  )
  const row = rows[0]
  return {
    version: String(row.version),
    sqlMode: String(row.sqlMode ?? ''),
    globalTimeZone: String(row.globalTimeZone),
    logBin: Number(row.logBin) === 1,
    trustFunctionCreators: Number(row.trustFunctionCreators) === 1,
    charset: String(row.charset),
    collation: String(row.collation),
    lowerCaseTableNames: Number(row.lowerCaseTableNames),
    storageEngine: String(row.storageEngine),
    databaseName: row.databaseName == null ? null : String(row.databaseName),
    currentUser: String(row.currentUser),
  }
}

/** Removes password hashes / auth strings from SHOW GRANTS output before it is printed. */
export function redactGrant(line) {
  return String(line)
    .replace(/IDENTIFIED BY PASSWORD\s+'[^']*'/gi, "IDENTIFIED BY PASSWORD '<redacted>'")
    .replace(/IDENTIFIED (VIA|WITH)\s+(\S+)\s+(USING|AS|BY)\s+'[^']*'/gi, "IDENTIFIED $1 $2 $3 '<redacted>'")
}

function errorSummary(e) {
  return e?.code ? `${e.code}: ${e.sqlMessage ?? e.message}` : String(e?.message ?? e)
}

/**
 * Creates and always drops a uniquely named probe table, view and trigger to prove that every
 * SQL feature the migrations rely on is available AND enforced for this user on this server.
 * Touches no existing object.
 * @param {{ query: Function }} conn
 * @returns {Promise<{ ok: boolean, steps: { name: string, ok: boolean, detail?: string }[] }>}
 */
export async function probeDdlCapabilities(conn) {
  const suffix = randomBytes(4).toString('hex')
  const table = `_lockin_probe_${suffix}`
  const view = `_lockin_probe_v_${suffix}`
  const trigger = `_lockin_probe_tr_${suffix}`
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const steps = []

  const expectOk = async (name, sql) => {
    try {
      await conn.query(sql)
      steps.push({ name, ok: true })
      return true
    } catch (e) {
      steps.push({ name, ok: false, detail: errorSummary(e) })
      return false
    }
  }
  const expectRejected = async (name, sql) => {
    try {
      await conn.query(sql)
      steps.push({ name, ok: false, detail: 'The statement was accepted, so the rule is NOT enforced.' })
      return false
    } catch {
      steps.push({ name, ok: true })
      return true
    }
  }

  try {
    const ran =
      (await expectOk(
        'CREATE TABLE with CHECK, STORED generated column and JSON column',
        `CREATE TABLE \`${table}\` (
           id INT NOT NULL PRIMARY KEY,
           url VARCHAR(100) NOT NULL,
           url_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin AS (SHA2(url, 256)) STORED,
           doc JSON NULL,
           CONSTRAINT ck_${suffix}_https CHECK (url REGEXP '^https://')
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      )) &&
      (await expectOk('INSERT a valid row', `INSERT INTO \`${table}\` (id, url, doc) VALUES (1, 'https://ok.example', '{"a":1}')`)) &&
      (await expectRejected('CHECK constraints are enforced', `INSERT INTO \`${table}\` (id, url) VALUES (2, 'http://bad.example')`)) &&
      (await expectOk('ALTER TABLE ... DROP CONSTRAINT', `ALTER TABLE \`${table}\` DROP CONSTRAINT ck_${suffix}_https`)) &&
      (await expectOk('ALTER TABLE ... ADD CONSTRAINT CHECK', `ALTER TABLE \`${table}\` ADD CONSTRAINT ck_${suffix}_https CHECK (url REGEXP '^https://')`)) &&
      (await expectOk('CREATE VIEW', `CREATE VIEW \`${view}\` AS SELECT id, url_sha256 FROM \`${table}\` WHERE id > 0`)) &&
      (await expectOk('SELECT from view', `SELECT * FROM \`${view}\``)) &&
      (await expectOk(
        'CREATE TRIGGER with SIGNAL (append-only guard)',
        `CREATE TRIGGER \`${trigger}\` BEFORE UPDATE ON \`${table}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'probe is append-only'`,
      )) &&
      (await expectRejected('trigger blocks UPDATE', `UPDATE \`${table}\` SET url = 'https://changed.example' WHERE id = 1`)) &&
      (await expectOk("SET time_zone = '+00:00' (no tz tables needed)", "SET time_zone = '+00:00'"))
    return { ok: ran && steps.every((s) => s.ok), steps }
  } finally {
    await conn.query(`DROP VIEW IF EXISTS \`${view}\``).catch(() => {})
    await conn.query(`DROP TABLE IF EXISTS \`${table}\``).catch(() => {})
  }
}

/** Human-readable remediation for the most likely probe failure on shared hosting. */
export function probeAdvice(server) {
  const advice = []
  if (server.logBin && !server.trustFunctionCreators)
    advice.push(
      'Binary logging is ON and log_bin_trust_function_creators is OFF, so CREATE TRIGGER needs SUPER. Ask the host to enable log_bin_trust_function_creators or grant the privilege; do not migrate until the probe passes.',
    )
  return advice
}
