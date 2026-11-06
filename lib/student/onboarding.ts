import 'server-only'
import type { RowDataPacket } from 'mysql2/promise'
import { getAdminPool } from '@/lib/db/pool'
import { newAccountsAllowed, studentEmailAllowed } from '@/lib/identity/policy'
import { PASSWORD_POLICY } from '@/lib/auth-options.mjs'
import { clock, takeToken } from '@/lib/auth-throttle'
import { getAuth } from '@/lib/auth'
import { ageAttestation, clearAttestationName, normalizeFullName } from '@/lib/student/age-attestation'

// The one way a student profile is created outside the CLI/sandbox: a person who signed in (Google,
// Microsoft, Apple, Yahoo or an emailed code) confirms they are 18 or older and accepts the privacy notice. Both are recorded on the
// profile (age_confirmed_at, privacy_notice_version). Without that the account reaches nothing.
//
// Never for: team accounts (any admin_members row, even revoked), users who already have or had a
// profile (suspended or erased stay that way), accounts whose email was never verified (the CLI
// creates staff unverified; every student sign-in method verifies it), or while sign-up is closed.

// Recorded on the profile as the consent record: which notice the student accepted, and when (created_at).
// Change it whenever /privacy changes in substance, so consent can be traced to the exact text.
export const PRIVACY_NOTICE_VERSION = 'student-2026-11-draft'

const ELIGIBLE = `SELECT u.id, u.name, u.email,
         (SELECT COUNT(*) FROM admin_members m WHERE m.user_id = u.id) AS memberships,
         (SELECT COUNT(*) FROM student_profiles s WHERE s.user_id = u.id) AS profiles,
         u.emailVerified AS verified
    FROM auth_user u WHERE u.id = ?`

export async function canStartStudentProfile(userId: string, db: Pick<ReturnType<typeof getAdminPool>, 'query'> = getAdminPool()): Promise<boolean> {
  // Public sign-up, or pre-launch tester mode for a listed address only (lib/identity/policy.ts).
  if (!newAccountsAllowed()) return false
  const [rows] = await db.query<RowDataPacket[]>(ELIGIBLE, [userId])
  const r = rows[0]
  return Boolean(r) && studentEmailAllowed(String(r.email)) && Number(r.memberships) === 0 && Number(r.profiles) === 0 && Number(r.verified) === 1
}

export type OnboardingResult = { ok: true } | { ok: false; status: number; error: string }

// Every password set here costs a hash (~60 ms of CPU): one process-wide budget before any hashing.
export const PASSWORD_SET_LIMIT = { burst: 10, perSecond: 1 }

/**
 * Sets the signed-in user's first password through Better Auth's server-only setPassword, which
 * needs a fresh session (a sign-up is one) and refuses an account that already has a password.
 */
async function setStudentPassword(password: string, headers: Headers | undefined): Promise<OnboardingResult> {
  const { minPasswordLength: min, maxPasswordLength: max } = PASSWORD_POLICY
  if (password.length < min || password.length > max) return { ok: false, status: 400, error: `Use a password of ${min} to ${max} characters.` }
  const auth = getAuth()
  if (!auth || !headers) return { ok: false, status: 503, error: 'Sign-in is temporarily unavailable. Please try again shortly.' }
  if (takeToken('password-set', PASSWORD_SET_LIMIT, clock.now()) > 0) return { ok: false, status: 429, error: 'Too many requests. Please try again in a moment.' }
  try {
    await auth.api.setPassword({ body: { newPassword: password }, headers })
    return { ok: true }
  } catch (error) {
    const code = (error as { body?: { code?: string } }).body?.code
    if (code === 'PASSWORD_ALREADY_SET') return { ok: false, status: 409, error: 'This account already has a password.' }
    if (code === 'SESSION_NOT_FRESH' || (error as { statusCode?: number }).statusCode === 401 || (error as { statusCode?: number }).statusCode === 403)
      return { ok: false, status: 403, error: 'Sign in again to set your password.' }
    throw error
  }
}

/**
 * Creates the profile after the privacy acknowledgement and an 18+ confirmation: the attestation made
 * on /age-confirm before this account existed (D-045), or, for an older account without one, the tick
 * sent here. Idempotent per user.
 */
export async function createStudentProfile(
  userId: string,
  input: { ageConfirmed?: unknown; privacyAccepted?: unknown; displayName?: unknown; password?: unknown },
  headers?: Headers,
): Promise<OnboardingResult> {
  const pool = getAdminPool()
  const attestation = await ageAttestation(userId, pool)
  if ((!attestation && input.ageConfirmed !== true) || input.privacyAccepted !== true)
    return { ok: false, status: 400, error: 'Confirm that you are 18 or older and accept the privacy notice to continue.' }
  const chosenName = input.displayName === undefined || input.displayName === '' ? null : normalizeFullName(input.displayName)
  if (input.displayName !== undefined && input.displayName !== '' && !chosenName) return { ok: false, status: 400, error: 'Enter your full name, using letters only.' }
  if (!(await canStartStudentProfile(userId, pool))) return { ok: false, status: 403, error: 'This account cannot create a student profile.' }
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT u.name, (SELECT COUNT(*) FROM auth_account a WHERE a.userId = u.id) AS methods FROM auth_user u WHERE u.id = ?',
    [userId],
  )
  // An account made with an emailed code has no sign-in method of its own yet, so it sets a password
  // here (then signs in at /sign-in/email). Provider accounts, or one that already has a password, need none.
  const password = typeof input.password === 'string' && input.password !== '' ? input.password : null
  if (!password && Number(rows[0]?.methods ?? 0) === 0) return { ok: false, status: 400, error: `Choose a password of at least ${PASSWORD_POLICY.minPasswordLength} characters.` }
  if (password) {
    const set = await setStudentPassword(password, headers)
    if (!set.ok) return set
  }
  // The name typed here, else the one given on /age-confirm, else the provider's for an older account.
  const name = chosenName ?? attestation?.fullName ?? (String(rows[0]?.name ?? '').trim().slice(0, 120) || 'Student')
  // INSERT IGNORE + UNIQUE(user_id): a double submit cannot create two profiles.
  await pool.query(
    "INSERT IGNORE INTO student_profiles (user_id, display_name, status, age_confirmed_at, privacy_notice_version) VALUES (?, ?, 'active', COALESCE(?, UTC_TIMESTAMP(3)), ?)",
    [userId, name, attestation?.confirmedAt ?? null, PRIVACY_NOTICE_VERSION],
  )
  await clearAttestationName(userId, pool)
  return { ok: true }
}

/**
 * "I'm under 18" or "cancel": removes the Google sign-in this person just created, so nothing about
 * them is kept. Only for an account that never became a student or team member.
 */
export async function discardUnfinishedAccount(userId: string): Promise<OnboardingResult> {
  const pool = getAdminPool()
  if (!(await canStartStudentProfile(userId, pool))) return { ok: false, status: 403, error: 'This account cannot be removed here.' }
  await clearAttestationName(userId, pool)
  // auth_session and auth_account rows go with it (ON DELETE CASCADE).
  await pool.query('DELETE FROM auth_user WHERE id = ? AND NOT EXISTS (SELECT 1 FROM admin_members m WHERE m.user_id = ?) AND NOT EXISTS (SELECT 1 FROM student_profiles s WHERE s.user_id = ?)', [
    userId,
    userId,
    userId,
  ])
  return { ok: true }
}

/** The onboarding step must ask for a password: the account has no sign-in method of its own (made with an emailed code). */
export async function needsPassword(userId: string, db: Pick<ReturnType<typeof getAdminPool>, 'query'> = getAdminPool()): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM auth_account WHERE userId = ?', [userId])
  return Number(rows[0]?.n ?? 0) === 0
}
