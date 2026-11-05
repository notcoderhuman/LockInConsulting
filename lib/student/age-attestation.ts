import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getAdminPool } from '@/lib/db/pool'

// The 18+ self-attestation that must come before a NEW student account is created (D-045).
// /age-confirm issues a random token: the browser keeps it in an HttpOnly cookie, the database keeps
// only its SHA-256. The Google sign-up callback (lib/auth.ts, user.create.before) consumes it once,
// before it expires, or Better Auth creates no account. A cancelled sign-up revokes it. This is an
// attestation by the person, not age or identity verification.

export const AGE_POLICY_VERSION = 'student-age-2026-10'
export const AGE_ATTESTATION_TTL_SECONDS = 15 * 60
// Request budget for /api/student/age-confirmation (unauthenticated; each call writes a row).
export const AGE_CONFIRM_LIMITS = { global: { burst: 30, perSecond: 1 / 2 }, perIp: { burst: 5, perSecond: 1 / 60 } }
// __Host-: Secure, path=/ and no Domain, so no other host or path can set or overwrite it.
export const AGE_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-lockin_age' : 'lockin_age'

type Db = Pick<ReturnType<typeof getAdminPool>, 'query'>
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const TOKEN = /^[A-Za-z0-9_-]{43}$/
// Letters of any script (and their combining marks), spaces, and . ' ’ - between them.
const FULL_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u

/** The name given on /age-confirm, tidied, or null when it cannot be a name. */
export function normalizeFullName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ')
  return name.length >= 2 && name.length <= 120 && FULL_NAME.test(name) ? name : null
}

/** Set-Cookie value for a new token, or for clearing it (token null). */
export function ageCookieHeader(token: string | null): string {
  return [
    `${AGE_COOKIE}=${token ?? ''}`,
    'Path=/',
    `Max-Age=${token ? AGE_ATTESTATION_TTL_SECONDS : 0}`,
    'HttpOnly',
    // Lax: sent on Google's top-level redirect back to the callback, never on cross-site subrequests.
    'SameSite=Lax',
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ')
}

/** Reads the token from a Cookie header; anything not shaped like one of ours is ignored. */
export function ageTokenFrom(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === AGE_COOKIE) {
      const value = rest.join('=')
      return TOKEN.test(value) ? value : null
    }
  }
  return null
}

export async function issueAgeAttestation(fullName: string, db: Db = getAdminPool()): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  // shortcut: expired unused rows (and the names on them) go when the next confirmation is issued, so one can
  // outlive its 15 minutes on a quiet site. Upgrade to a scheduled purge if the host gets a cron job.
  await db.query('DELETE FROM student_age_attestations WHERE user_id IS NULL AND expires_at < UTC_TIMESTAMP(3)')
  await db.query('INSERT INTO student_age_attestations (token_sha256, policy_version, full_name, expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL ? SECOND)', [
    hash(token),
    AGE_POLICY_VERSION,
    fullName,
    AGE_ATTESTATION_TTL_SECONDS,
  ])
  return token
}

/** Spends the token: true exactly once, while unexpired and not revoked. Atomic. */
export async function consumeAgeAttestation(token: string | null, db: Db = getAdminPool()): Promise<boolean> {
  if (!token) return false
  const [res] = await db.query<ResultSetHeader>(
    'UPDATE student_age_attestations SET consumed_at = UTC_TIMESTAMP(3) WHERE token_sha256 = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)',
    [hash(token)],
  )
  return res.affectedRows === 1
}

/** Links a consumed token to the account it created. */
export async function bindAgeAttestation(token: string | null, userId: string, db: Db = getAdminPool()): Promise<void> {
  if (!token) return
  await db.query('UPDATE student_age_attestations SET user_id = ? WHERE token_sha256 = ? AND consumed_at IS NOT NULL AND user_id IS NULL', [userId, hash(token)])
}

/** Cancelled or abandoned flow: the token can never be used. */
export async function revokeAgeAttestation(token: string | null, db: Db = getAdminPool()): Promise<void> {
  if (!token) return
  await db.query('UPDATE student_age_attestations SET revoked_at = UTC_TIMESTAMP(3), full_name = NULL WHERE token_sha256 = ? AND consumed_at IS NULL AND revoked_at IS NULL', [hash(token)])
}

/** What this account's creator attested on /age-confirm, or null for an older account. */
export async function ageAttestation(userId: string, db: Db = getAdminPool()): Promise<{ confirmedAt: string; fullName: string | null } | null> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT confirmed_at, full_name FROM student_age_attestations WHERE user_id = ? AND consumed_at IS NOT NULL', [userId])
  return rows[0] ? { confirmedAt: String(rows[0].confirmed_at), fullName: rows[0].full_name == null ? null : String(rows[0].full_name) } : null
}

/** The name now lives on the profile, or the sign-in is being discarded: none stays here. */
export async function clearAttestationName(userId: string, db: Db = getAdminPool()): Promise<void> {
  await db.query('UPDATE student_age_attestations SET full_name = NULL WHERE user_id = ?', [userId])
}
