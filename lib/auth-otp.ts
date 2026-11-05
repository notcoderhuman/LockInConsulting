import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { Pool } from 'mysql2/promise'
import { clientIpHeader, clock, giveTokenBack, maybeCleanup, takeToken } from '@/lib/auth-throttle'

// Email one-time codes (Better Auth's emailOTP plugin, wired in lib/auth.ts) with the limits the
// plugin does not have on its own. Better Auth's built-in limiter is per IP, and this deployment
// trusts no IP header by default (lib/auth-throttle.ts, R-033), so every limit here is keyed by the
// email address, which is also the account: one email belongs to exactly one auth_user.
//
// Code itself (lib/auth.ts): 6 digits, OTP_TTL_SECONDS, at most OTP_ALLOWED_ATTEMPTS wrong guesses,
// consumed atomically on first success (single use), stored only as an HMAC keyed by
// BETTER_AUTH_SECRET (otpHasher), so a database dump alone cannot brute-force the 10^6 space.
//
// Here, before Better Auth sees the request:
//   send   (/email-otp/send-verification-otp, /email-otp/request-password-reset)
//     - only the "sign-in" and "forget-password" purposes; JSON bodies only
//     - per email: one code per OTP_LIMITS.cooldownMs (resend cooldown), OTP_LIMITS.sendsPerHour an hour
//     - process-wide budget (and per IP only with a verified AUTH_CLIENT_IP_HEADER) so nobody can
//       use the site to mail-bomb many addresses or run up the mail bill
//     - a resend replaces the earlier code: only the newest one works
//     - staff emails get the same "sent" answer but no code: staff sign in only with their password
//   verify (/sign-in/email-otp, /email-otp/reset-password)
//     - per email: OTP_LIMITS.verifiesPerHour guesses an hour across all codes, so resending cannot
//       multiply guesses (5 codes x 3 guesses is still capped at 10)

type Db = Pick<Pool, 'query'>

export const OTP_TTL_SECONDS = 10 * 60
export const OTP_ALLOWED_ATTEMPTS = 3
export const OTP_LIMITS = {
  cooldownMs: 60_000,
  sendsPerHour: 5,
  verifiesPerHour: 10,
  globalSend: { burst: 20, perSecond: 1 / 6 },
  perIpSend: { burst: 5, perSecond: 1 / 120 },
}
const HOUR = 60 * 60 * 1000

export const OTP_SEND_PATHS = ['/email-otp/send-verification-otp', '/email-otp/request-password-reset']
export const OTP_VERIFY_PATHS = ['/sign-in/email-otp', '/email-otp/reset-password']
// The rest of the plugin is switched off in DISABLED_AUTH_PATHS (lib/auth-options.mjs).

const NO_STORE = { 'Cache-Control': 'no-store' }
const TOO_MANY = { message: 'Too many requests. Please try again later.' }
const MAX_BODY_CHARS = 16 * 1024

/** Stored form of a code: HMAC, so the hash is useless without the server secret. */
export const otpHasher = (secret: string) => async (otp: string) => createHmac('sha256', secret).update(`lockin:email-otp:v1\n${otp}`).digest('base64url')

const emailHash = (email: string) => createHash('sha256').update(email).digest('hex')
export const otpKeys = (email: string) => {
  const h = emailHash(email.trim().toLowerCase())
  return { cooldown: `otp-cooldown:${h}`, send: `otp-send:${h}`, verify: `otp-verify:${h}` }
}

/**
 * Counts one request in a fixed window stored in auth_rate_limit (lastRequest = window start).
 * Returns 0 when within `max`, otherwise ms until the window ends. One atomic upsert, so parallel
 * requests can only over-count (stricter), never under-count.
 */
export async function hitWindow(db: Db, key: string, windowMs: number, max: number, now = clock.now()): Promise<number> {
  const stale = now - windowMs
  // Assignments run left to right: `count` still sees the old lastRequest.
  await db.query(
    'INSERT INTO auth_rate_limit (id, `key`, `count`, lastRequest) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE `count` = IF(lastRequest <= ?, 1, `count` + 1), lastRequest = IF(lastRequest <= ?, ?, lastRequest)',
    [randomUUID(), key, now, stale, stale, now],
  )
  const [rows] = await db.query('SELECT `count`, lastRequest FROM auth_rate_limit WHERE `key` = ?', [key])
  const row = (rows as { count: number; lastRequest: number | string }[])[0]
  return Number(row.count) > max ? Math.max(1, Number(row.lastRequest) + windowMs - now) : 0
}

async function isStaffEmail(db: Db, email: string): Promise<boolean> {
  const [rows] = await db.query('SELECT 1 FROM auth_user u JOIN admin_members m ON m.user_id = u.id WHERE u.email = ? LIMIT 1', [email])
  return (rows as unknown[]).length > 0
}

const tooMany = (ms: number) => Response.json(TOO_MANY, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))) } })
const bad = (message = 'Invalid request.', status = 400) => Response.json({ message }, { status, headers: NO_STORE })

/** Wraps the emailOTP endpoints listed above. Anything else is passed through untouched. */
export async function guardEmailOtp(request: Request, handle: (request: Request) => Promise<Response>, db: Db): Promise<Response> {
  const path = new URL(request.url).pathname
  const isSend = OTP_SEND_PATHS.some((p) => path.endsWith(p))
  if (!isSend && !OTP_VERIFY_PATHS.some((p) => path.endsWith(p))) return handle(request)
  const now = clock.now()
  await maybeCleanup(db, now)
  if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return bad('Unsupported content type.', 415)
  const raw = await request.text()
  if (raw.length > MAX_BODY_CHARS) return bad()
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return bad()
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254) return bad()
  const forward = () => handle(new Request(request.url, { method: 'POST', headers: request.headers, body: raw }))
  const keys = otpKeys(email)

  if (!isSend) {
    const wait = await hitWindow(db, keys.verify, HOUR, OTP_LIMITS.verifiesPerHour, now)
    if (wait > 0) return tooMany(wait)
    const response = await forward()
    // Better Auth 1.7.8 throws (500) when user.create.before refuses a new account, e.g. without an
    // 18+ confirmation (lib/auth.ts). Nothing was created: say so instead of reporting a server error.
    if (response.status >= 500 && path.endsWith('/sign-in/email-otp')) {
      const [rows] = await db.query('SELECT 1 FROM auth_user WHERE email = ? LIMIT 1', [email])
      if (!(rows as unknown[]).length)
        return Response.json({ code: 'FAILED_TO_CREATE_USER', message: 'Account not created. Confirm that you are 18 or older first.' }, { status: 422, headers: NO_STORE })
    }
    return response
  }

  const type = path.endsWith('/request-password-reset') ? 'forget-password' : body.type
  if (type !== 'sign-in' && type !== 'forget-password') return bad()
  const ipHeader = clientIpHeader()
  if (ipHeader) {
    const ipWait = takeToken(`otp-ip:${(request.headers.get(ipHeader) ?? '').trim().slice(0, 64) || 'missing'}`, OTP_LIMITS.perIpSend, now)
    if (ipWait > 0) return tooMany(ipWait)
  }
  const globalWait = takeToken('otp-global', OTP_LIMITS.globalSend, now)
  if (globalWait > 0) return tooMany(globalWait)
  const wait = (await hitWindow(db, keys.cooldown, OTP_LIMITS.cooldownMs, 1, now)) || (await hitWindow(db, keys.send, HOUR, OTP_LIMITS.sendsPerHour, now))
  if (wait > 0) {
    giveTokenBack('otp-global')
    return tooMany(wait)
  }
  // Same answer as a real send, so the form cannot tell anyone which emails belong to staff.
  if (await isStaffEmail(db, email)) return Response.json({ success: true }, { headers: NO_STORE })
  // One live code per email and purpose: a resend makes every earlier code useless.
  await db.query('DELETE FROM auth_verification WHERE identifier = ?', [`${type}-otp-${email}`])
  return forward()
}
