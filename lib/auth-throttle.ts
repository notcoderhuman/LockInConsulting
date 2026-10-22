import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'mysql2/promise'

// Sign-in throttling that never trusts a client-supplied IP and cannot be used to lock a user out.
//
// 1. Client IP: only the header named in AUTH_CLIENT_IP_HEADER is believed, and only when the
//    hosting proxy overwrites it on every request (e.g. "x-real-ip"). With no such header,
//    Better Auth gets `disableIpTracking`, so X-Forwarded-For is ignored entirely and requests
//    without an IP are never pooled into one shared per-path bucket (RISKS.md R-033).
// 2. Per account, bounded progressive delay (no hard lockout): the first FREE_FAILURES attempts
//    are free; after that each attempt must wait 15 s, 30 s, 60 s, 120 s, then at most
//    MAX_DELAY_MS. A slot is claimed atomically before the password is checked, so concurrent
//    requests cannot multiply it; only a successful sign-in gives it back. The count is forgotten
//    after QUIET_RESET_MS (1 hour) without an attempt, long enough that pausing to regain the free
//    attempts never beats the sustained cap of about one attempt per 3 minutes per account
//    (≈480 a day, the same as the earlier 5-per-15-minutes lockout). A user can always try again
//    after a bounded wait. Keyed by a hash of the normalised email, identically for unknown emails.
// 3. Device cookie (OWASP "device cookies"): a successful sign-in sets an HMAC-signed cookie
//    bound to that account and to its current stored password hash (inside the MAC only, never
//    in the cookie), so changing the password invalidates every cookie issued before. Attempts
//    carrying a valid cookie are counted in that device's own bucket, so an attacker who only
//    knows the email can slow down unrecognised browsers but never the victim's own. A success
//    on a recognised device clears only that device's bucket, so the victim's routine sign-ins
//    never hand an attacker fresh free attempts. Stored in Better Auth's auth_rate_limit table
//    under "account:"/"device:" keys.
// 4. Only JSON bodies (what the app's own forms send) reach Better Auth's sign-in. It also
//    accepts form-encoded bodies, which this wrapper would not see the email of, so anything
//    else is refused with 415 before any password is checked.
// 5. Request budget before the password hash (~60 ms of CPU on Node's main thread, run even for
//    unknown emails). Every unrecognised-browser attempt takes a token from one process-wide
//    bucket (signInRateLimits.global), so a flood of random emails cannot saturate the process
//    whatever IP headers it sends; recognised devices skip it, so owners still sign in during a
//    flood. Tokens are given back when nothing was hashed. Only with a verified
//    AUTH_CLIENT_IP_HEADER is a per-IP bucket applied first (a request without that header shares
//    one bucket), so one client cannot drain the global budget.
//    shortcut: in-memory, per Node process; with several processes each has its own budget, so
//    move it to a shared store if the app is ever scaled out.
// 6. Rows idle for QUIET_RESET_MS already count as empty, so at most once per CLEANUP_INTERVAL_MS
//    any sign-in request (successful or not) deletes a bounded batch of them.

type Env = Record<string, string | undefined>
type Db = Pick<Pool, 'query' | 'getConnection'>

export const FREE_FAILURES = 5
export const BASE_DELAY_MS = 15_000
export const MAX_DELAY_MS = 180_000
export const QUIET_RESET_MS = 60 * 60 * 1000
export const DEVICE_COOKIE = 'lockin_signin_device'
const DEVICE_MAX_AGE_S = 180 * 24 * 60 * 60
const MAX_BODY_CHARS = 16 * 1024
// Same text as Better Auth's own 429, so throttled responses look alike whatever triggered them.
const TOO_MANY = { message: 'Too many requests. Please try again later.' }

/** Injectable for tests; the throttle never reads Date.now() directly. */
export const clock = { now: () => Date.now() }

// ≈4 hashes a second keeps password checks to about a quarter of one CPU core.
export const signInRateLimits = { global: { burst: 10, perSecond: 4 }, perIp: { burst: 5, perSecond: 1 / 60 } }
export const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
// Rows are only created after a global token, so one batch outpaces creation (~2,400 per interval).
export const CLEANUP_BATCH = 5000
const MAX_TRACKED_IPS = 10_000

type Limit = { burst: number; perSecond: number }
type Bucket = { tokens: number; at: number; limit: Limit }
const buckets = new Map<string, Bucket>()
let nextCleanup = 0

/** Clears in-memory request buckets and the cleanup timer (tests). */
export function resetRequestBuckets() {
  buckets.clear()
  nextCleanup = 0
}

const refilled = (b: Bucket, now: number) => Math.min(b.limit.burst, b.tokens + (Math.max(0, now - b.at) / 1000) * b.limit.perSecond)

/** Takes one token: 0 when granted, otherwise ms until the next one. */
function takeToken(key: string, limit: Limit, now: number): number {
  // Full buckets carry no information, so forgetting them keeps one entry per active client IP.
  if (buckets.size > MAX_TRACKED_IPS) for (const [k, b] of buckets) if (refilled(b, now) >= b.limit.burst) buckets.delete(k)
  const b = buckets.get(key) ?? { tokens: limit.burst, at: now, limit }
  b.tokens = refilled(b, now)
  b.at = now
  buckets.set(key, b)
  if (b.tokens >= 1) {
    b.tokens -= 1
    return 0
  }
  return Math.ceil(((1 - b.tokens) / limit.perSecond) * 1000)
}

function giveTokenBack(key: string) {
  const b = buckets.get(key)
  if (b) b.tokens = Math.min(b.limit.burst, b.tokens + 1)
}

/** Deletes up to `limit` rows idle for QUIET_RESET_MS, which reserveAttempt already treats as empty. */
export async function pruneStaleRows(db: Pick<Pool, 'query'>, now = clock.now(), limit = CLEANUP_BATCH): Promise<number> {
  // shortcut: no index on lastRequest, so this scans the table; fine while cleanup keeps it to a
  // few thousand rows, add an index if it ever grows to hundreds of thousands.
  const [res] = await db.query('DELETE FROM auth_rate_limit WHERE lastRequest < ? LIMIT ?', [now - QUIET_RESET_MS, limit])
  return (res as { affectedRows: number }).affectedRows
}

/** The header a trusted proxy overwrites with the client IP, or null to trust no header. */
export function clientIpHeader(env: Env = process.env): string | null {
  const header = (env.AUTH_CLIENT_IP_HEADER ?? '').trim().toLowerCase()
  return /^[a-z0-9-]{1,64}$/.test(header) ? header : null
}

/** Better Auth `advanced.ipAddress` for this deployment. */
export function authIpAddressOptions(env: Env = process.env): { ipAddressHeaders: string[] } | { disableIpTracking: true } {
  const header = clientIpHeader(env)
  return header ? { ipAddressHeaders: [header] } : { disableIpTracking: true }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const accountHash = (email: string) => sha256(email.trim().toLowerCase())

export const accountThrottleKey = (email: string) => `account:${accountHash(email)}|/sign-in/email`
const deviceThrottleKey = (nonce: string) => `device:${sha256(nonce)}|/sign-in/email`

/** Required wait before the next attempt after `failures` failures, in ms (0 = allowed now). */
export function requiredDelayMs(failures: number): number {
  if (failures < FREE_FAILURES) return 0
  return Math.min(BASE_DELAY_MS * 2 ** (failures - FREE_FAILURES), MAX_DELAY_MS)
}

// ---- Device cookie -----------------------------------------------------------------------

function deviceKey(secret: string) {
  return createHmac('sha256', secret).update('lockin:signin-device:v1').digest()
}

// `credential` is the account's stored password hash: it only enters the MAC, so the cookie
// reveals nothing about it, and any password change makes earlier cookies fail verification.
const deviceMac = (secret: string, payload: string, credential: string) =>
  createHmac('sha256', deviceKey(secret)).update(`${payload}\n${credential}`).digest()

export function issueDeviceToken(email: string, secret: string, credential: string, now = clock.now()): string {
  const payload = `${accountHash(email)}.${randomBytes(16).toString('base64url')}.${now}`
  return `${payload}.${deviceMac(secret, payload, credential).toString('base64url')}`
}

/** The device nonce if `token` is a valid, unexpired device cookie for this email and password state, else null. */
export function verifyDeviceToken(token: string | undefined, email: string, secret: string, credential: string | null, now = clock.now()): string | null {
  const parts = (token ?? '').split('.')
  if (parts.length !== 4 || !credential) return null
  const [account, nonce, issued, mac] = parts
  const expected = deviceMac(secret, `${account}.${nonce}.${issued}`, credential)
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  if (account !== accountHash(email)) return null
  const age = now - Number(issued)
  return Number.isFinite(age) && age >= 0 && age < DEVICE_MAX_AGE_S * 1000 ? nonce : null
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

// ---- Buckets -----------------------------------------------------------------------------

/**
 * Atomically claims an attempt slot for `key` BEFORE the password is checked, so parallel
 * requests cannot all pass a read-then-write check. Returns 0 when the slot is granted, otherwise
 * the milliseconds until the next slot. The row lock is held only for this check, never during
 * the password hash.
 */
export async function reserveAttempt(db: Db, key: string, now = clock.now()): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      // ODKU (not INSERT IGNORE) takes an exclusive lock on an existing row, so callers queue here.
      await conn.query('INSERT INTO auth_rate_limit (id, `key`, `count`, lastRequest) VALUES (?, ?, 0, 0) ON DUPLICATE KEY UPDATE `key` = `key`', [randomUUID(), key])
      const [rows] = await conn.query('SELECT `count`, lastRequest FROM auth_rate_limit WHERE `key` = ? FOR UPDATE', [key])
      const row = (rows as { count: number; lastRequest: number | string }[])[0]
      const last = Number(row.lastRequest)
      const used = now - last >= QUIET_RESET_MS ? 0 : Number(row.count)
      const wait = last + requiredDelayMs(used) - now
      if (used > 0 && wait > 0) {
        await conn.commit()
        return wait
      }
      await conn.query('UPDATE auth_rate_limit SET `count` = ?, lastRequest = ? WHERE `key` = ?', [used + 1, now, key])
      await conn.commit()
      return 0
    } catch (error) {
      await conn.rollback().catch(() => {})
      // Two first-ever attempts for a new key can deadlock on the insert; retry briefly.
      if ((error as { code?: string }).code === 'ER_LOCK_DEADLOCK' && attempt < 3) continue
      throw error
    } finally {
      conn.release()
    }
  }
}

export async function clearFailures(db: Db, keys: string[]): Promise<void> {
  await db.query('DELETE FROM auth_rate_limit WHERE `key` IN (?)', [keys])
}

/** The stored password hash for this email (Better Auth lower-cases emails), or null. Never leaves the server. */
async function storedCredential(db: Db, email: string): Promise<string | null> {
  const [rows] = await db.query(
    "SELECT a.password FROM auth_account a JOIN auth_user u ON u.id = a.userId WHERE u.email = ? AND a.providerId = 'credential' LIMIT 1",
    [email.trim().toLowerCase()],
  )
  const hash = (rows as { password: string | null }[])[0]?.password
  return hash || null
}

// ---- Wrapper -----------------------------------------------------------------------------

/** Wraps Better Auth's POST /sign-in/email with the per-account / per-device throttle. */
export async function throttleEmailSignIn(
  request: Request,
  handle: (request: Request) => Promise<Response>,
  db: Db,
  secret = process.env.BETTER_AUTH_SECRET ?? '',
): Promise<Response> {
  const now = clock.now()
  if (now >= nextCleanup) {
    nextCleanup = now + CLEANUP_INTERVAL_MS
    await pruneStaleRows(db, now).catch((error) => console.error('[auth] throttle cleanup failed', error instanceof Error ? error.name : 'unknown error'))
  }
  // Exact match: a missing, form, multipart or doubled ("a, b") Content-Type never reaches Better Auth.
  if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json')
    return Response.json({ message: 'Unsupported content type.' }, { status: 415, headers: { 'Cache-Control': 'no-store' } })
  const raw = await request.text()
  if (raw.length > MAX_BODY_CHARS) return Response.json({ message: 'Invalid request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  let email = ''
  try {
    const body: unknown = JSON.parse(raw)
    if (body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string') email = (body as { email: string }).email
  } catch {
    // Not JSON: Better Auth rejects it.
  }
  const forward = () => handle(new Request(request.url, { method: 'POST', headers: request.headers, body: raw }))
  if (!email.trim()) return forward()

  const accountKey = accountThrottleKey(email)
  const token = readCookie(request, DEVICE_COOKIE)
  const device = token ? verifyDeviceToken(token, email, secret, await storedCredential(db, email)) : null
  const tooMany = (ms: number) =>
    Response.json(TOO_MANY, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))) } })

  // Request budget, before anything is hashed. The IP comes only from a verified proxy header.
  const ipHeader = clientIpHeader()
  if (ipHeader) {
    const ipWait = takeToken(`ip:${(request.headers.get(ipHeader) ?? '').trim().slice(0, 64) || 'missing'}`, signInRateLimits.perIp, now)
    if (ipWait > 0) return tooMany(ipWait)
  }
  const budget = device ? null : 'global'
  if (budget) {
    const globalWait = takeToken(budget, signInRateLimits.global, now)
    if (globalWait > 0) return tooMany(globalWait)
  }

  // A recognised device has its own bucket; everyone else shares the account's bucket.
  const key = device ? deviceThrottleKey(device) : accountKey
  const wait = await reserveAttempt(db, key)
  if (wait > 0) {
    if (budget) giveTokenBack(budget)
    return tooMany(wait)
  }

  // The attempt is already counted; only a successful sign-in gives it back.
  const response = await forward()
  // 200 and 401 are the only answers that hashed a password; anything else did not use the budget.
  if (budget && response.status !== 200 && response.status !== 401) giveTokenBack(budget)
  if (!response.ok) return response

  // Proven knowledge of the password: clear the bucket this attempt used and (re)issue the device
  // cookie. A recognised device leaves the account bucket alone, so the owner's routine sign-ins
  // do not reset an attacker's delay.
  await clearFailures(db, [key])
  const credential = await storedCredential(db, email)
  if (!credential) return response
  const headers = new Headers(response.headers)
  const secure = new URL(request.url).protocol === 'https:' || (process.env.BETTER_AUTH_URL ?? '').startsWith('https:')
  headers.append(
    'Set-Cookie',
    `${DEVICE_COOKIE}=${issueDeviceToken(email, secret, credential)}; Path=/api/auth/sign-in; Max-Age=${DEVICE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  )
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
