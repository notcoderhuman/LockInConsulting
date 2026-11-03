// Settings every database connection needs, whatever the server's defaults are.
//
// UTC: CURDATE() in the public_* views must agree with todayIso(), and Better Auth's TIMESTAMP
// columns must round-trip without a server-timezone shift. An offset is used instead of a named
// zone because shared hosts often lack the MySQL time-zone tables.
//
// Strict mode: Hostinger's server default is not strict, so over-long text would be silently cut
// and bad dates stored as zeros. A session may set this itself; the shared global setting is never
// touched. The modes are added to the session's own list because each engine accepts different names.
export const SESSION_SETUP =
  "SET time_zone = '+00:00', SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), " +
  "'STRICT_TRANS_TABLES', 'ERROR_FOR_DIVISION_BY_ZERO', 'NO_ZERO_DATE', 'NO_ZERO_IN_DATE')"

/**
 * Runs SESSION_SETUP on each new pool connection. A connection that cannot be set up is destroyed,
 * so nothing ever runs on a non-strict session.
 * @param {import('mysql2/promise').Pool} pool
 */
export function enforceSession(pool) {
  pool.pool.on('connection', (connection) => {
    connection.query(SESSION_SETUP, (err) => {
      if (!err) return
      console.error(`Database session setup failed: ${err.code ?? err.message}`)
      connection.destroy()
    })
  })
}
