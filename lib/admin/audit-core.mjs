// Hash-chain core shared by the app (lib/admin/audit.ts) and scripts/admin-user.mjs, so both
// write audit rows with exactly the same algorithm. Plain JS so the Node script can import it.
import { createHash } from 'node:crypto'

export const GENESIS_HASH = '0'.repeat(64)

/**
 * Deterministic JSON: object keys sorted, undefined dropped. Used for storage and hashing.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  return JSON.stringify(value)
}

/**
 * @param {string} prevHash
 * @param {{ entityType: string, entityId: number, action: string, actorId: string, actorRole: string | null, reason: string | null, before: object | null, after: object | null }} entry
 * @param {string} createdAt `YYYY-MM-DD HH:MM:SS.mmm` (UTC)
 * @returns {string}
 */
export function computeRowHash(prevHash, entry, createdAt) {
  const body = canonicalJson({
    action: entry.action,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    after: entry.after,
    before: entry.before,
    createdAt,
    entityId: entry.entityId,
    entityType: entry.entityType,
    reason: entry.reason,
  })
  return createHash('sha256').update(`${prevHash}|${body}`).digest('hex')
}

/** @returns {string} */
export function utcTimestampMs(now = new Date()) {
  return now.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Appends one audit row. MUST run inside the same transaction as the change it records; the
 * FOR UPDATE lock on audit_chain_head serialises concurrent writers.
 * @param {import('mysql2/promise').PoolConnection | import('mysql2/promise').Connection} conn
 * @param {Parameters<typeof computeRowHash>[1]} entry
 * @returns {Promise<number>} the new log row id
 */
export async function appendChangeLogRow(conn, entry) {
  const [heads] = await conn.query('SELECT last_hash FROM audit_chain_head WHERE id = 1 FOR UPDATE')
  const head = /** @type {any[]} */ (heads)[0]
  if (!head) throw new Error('audit_chain_head is missing — run the migrations.')
  const prevHash = String(head.last_hash)
  const createdAt = utcTimestampMs()
  const rowHash = computeRowHash(prevHash, entry, createdAt)
  const [res] = await conn.query(
    `INSERT INTO data_change_log
       (entity_type, entity_id, action, actor_id, actor_role, reason, before_data, after_data, created_at, prev_hash, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.actorId,
      entry.actorRole,
      entry.reason,
      entry.before ? canonicalJson(entry.before) : null,
      entry.after ? canonicalJson(entry.after) : null,
      createdAt,
      prevHash,
      rowHash,
    ],
  )
  const insertId = /** @type {import('mysql2/promise').ResultSetHeader} */ (res).insertId
  await conn.query('UPDATE audit_chain_head SET last_log_id = ?, last_hash = ? WHERE id = 1', [insertId, rowHash])
  return insertId
}

/** @param {unknown} v */
function parseJsonColumn(v) {
  if (v == null) return null
  // MySQL returns JSON columns parsed; MariaDB stores JSON as LONGTEXT and returns a string.
  return typeof v === 'string' ? JSON.parse(v) : v
}

/**
 * Recomputes every hash in order. Requires a connection opened with `dateStrings: true`.
 * @param {{ query: Function }} db
 * @returns {Promise<{ ok: true, checked: number } | { ok: false, checked: number, brokenAtId: number | null, reason: string }>}
 */
export async function verifyAuditChain(db) {
  const [rows] = await db.query(
    `SELECT id, entity_type, entity_id, action, actor_id, actor_role, reason, before_data, after_data,
            created_at, prev_hash, row_hash
       FROM data_change_log ORDER BY id`,
  )
  const [heads] = await db.query('SELECT last_log_id, last_hash FROM audit_chain_head WHERE id = 1')
  const head = heads[0]
  let expectedPrev = GENESIS_HASH
  let checked = 0
  let chainStarted = false
  for (const r of rows) {
    if (r.row_hash == null) {
      if (chainStarted) return { ok: false, checked, brokenAtId: Number(r.id), reason: 'A row was added without a hash.' }
      continue // rows written before the chain existed (Stage 2) are outside it
    }
    chainStarted = true
    if (r.prev_hash !== expectedPrev)
      return { ok: false, checked, brokenAtId: Number(r.id), reason: 'A previous row was changed or deleted.' }
    const entry = {
      entityType: r.entity_type,
      entityId: Number(r.entity_id),
      action: r.action,
      actorId: String(r.actor_id),
      actorRole: r.actor_role ?? null,
      reason: r.reason ?? null,
      before: parseJsonColumn(r.before_data),
      after: parseJsonColumn(r.after_data),
    }
    if (computeRowHash(expectedPrev, entry, String(r.created_at)) !== r.row_hash)
      return { ok: false, checked, brokenAtId: Number(r.id), reason: 'This row was modified after it was written.' }
    expectedPrev = String(r.row_hash)
    checked += 1
  }
  if (!head || head.last_hash !== expectedPrev)
    return {
      ok: false,
      checked,
      brokenAtId: head?.last_log_id == null ? null : Number(head.last_log_id),
      reason: 'The newest rows were deleted, or the chain head was altered.',
    }
  return { ok: true, checked }
}
