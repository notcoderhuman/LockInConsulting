import type { Connection } from 'mysql2/promise'

// A suite's shared connection can sit unused while a test works through the app's pools. On an
// external server that outlives wait_timeout (Hostinger: 20 s) and the connection is closed
// silently, so every later test fails. Local runs never set this up.
//
// A ping runs only between queries, and a query waits for a ping in flight. A failed ping is never
// retried or hidden: it is logged at once and the next query rejects with the original error.
export function keepAlive(conn: Connection, intervalMs = 10_000): Connection {
  const query = conn.query.bind(conn) as (...args: unknown[]) => Promise<unknown>
  const end = conn.end.bind(conn)
  let active = 0
  let ping: Promise<void> | null = null
  let failure: Error | null = null

  const timer = setInterval(() => {
    if (active > 0 || ping) return
    ping = conn
      .ping()
      .catch((e: Error) => {
        failure = e
        clearInterval(timer)
        console.error(`[db] heartbeat failed, shared connection lost: ${e.message}`)
      })
      .finally(() => {
        ping = null
      })
  }, intervalMs)
  timer.unref()

  conn.query = (async (...args: unknown[]) => {
    while (ping) await ping
    if (failure) throw new Error(`Shared test connection lost: ${failure.message}`, { cause: failure })
    active += 1
    try {
      return await query(...args)
    } finally {
      active -= 1
    }
  }) as Connection['query']

  conn.end = (async () => {
    clearInterval(timer)
    await ping
    return end()
  }) as Connection['end']

  return conn
}
