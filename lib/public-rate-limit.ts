import { randomUUID } from 'node:crypto'
import type { Pool } from 'mysql2/promise'
import { clientIpHeader } from './auth-throttle'

// Request limits for the public university endpoints (/api/universities/search and /lookup), shared
// by every Node process through the database: the same auth_rate_limit table sign-in throttling uses
// (0002), under "public:" keys that cannot collide with Better Auth's or the sign-in throttle's.
// No migration. The auth pool writes it, so the public read pool stays SELECT-only.
//
// Fixed one-minute windows. One atomic INSERT … ON DUPLICATE KEY UPDATE per check: the counter
// restarts when its window has passed, and LAST_INSERT_ID(expr) hands back the new count without a
// second query or a lock held across statements. `lastRequest` holds the window start, so the sign-in
// throttle's cleanup (rows idle for an hour) also clears these.
//
// Client identity follows auth-throttle: an IP is believed only from AUTH_CLIENT_IP_HEADER, which a
// trusted proxy overwrites. Until that is configured (R-033) there is no per-client limit, only the
// site-wide ceiling, which protects the database from floods but can be used up by one heavy client.

export const PUBLIC_LIMITS = {
  search: { perClient: 60, global: 1200 },
  lookup: { perClient: 30, global: 600 },
} as const
export type PublicEndpoint = keyof typeof PUBLIC_LIMITS
export const WINDOW_MS = 60_000

type Db = Pick<Pool, 'query'>

/** Counts one request against `key` in the current window and returns the count so far. */
export async function hit(db: Db, key: string, now: number): Promise<number> {
  const windowStart = now - (now % WINDOW_MS)
  const [res] = await db.query(
    `INSERT INTO auth_rate_limit (id, \`key\`, \`count\`, lastRequest) VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       \`count\` = LAST_INSERT_ID(IF(lastRequest < ?, 1, \`count\` + 1)),
       lastRequest = GREATEST(lastRequest, ?)`,
    [randomUUID(), key, windowStart, windowStart, windowStart],
  )
  // A fresh row reports insertId 0: that is the first request of the window.
  return Number((res as { insertId: number }).insertId) || 1
}

/**
 * null when the request may go ahead, otherwise a 429 Response with Retry-After. A limiter failure
 * returns 503: the endpoint's own database read would fail the same way.
 */
export async function limitPublicRequest(request: Request, endpoint: PublicEndpoint, db?: Db, now = Date.now()): Promise<Response | null> {
  // No database configured: the endpoint answers 503 itself and has nothing to protect.
  if (!db && !process.env.DATABASE_URL) return null
  const limits = PUBLIC_LIMITS[endpoint]
  const header = clientIpHeader()
  const ip = header ? request.headers.get(header)?.trim() : null
  try {
    const pool = db ?? (await import('@/lib/db/pool')).getAuthPool()
    // A real client IP is short; anything else is treated as missing rather than stored as a key.
    if (ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip) && (await hit(pool, `public:${endpoint}:ip:${ip}`, now)) > limits.perClient) return tooMany(now)
    if ((await hit(pool, `public:${endpoint}:global`, now)) > limits.global) return tooMany(now)
    return null
  } catch (error) {
    console.error('[rate-limit] public limiter failed', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Unavailable right now.' }, { status: 503 })
  }
}

function tooMany(now: number): Response {
  const retryAfter = Math.ceil((WINDOW_MS - (now % WINDOW_MS)) / 1000)
  return Response.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
}
