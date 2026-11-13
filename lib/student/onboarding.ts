import 'server-only'
import type { RowDataPacket } from 'mysql2/promise'
import { getAdminPool } from '@/lib/db/pool'
import { newAccountsAllowed } from '@/lib/identity/policy'
import { ageAttestation, clearAttestationName, normalizeFullName } from '@/lib/student/age-attestation'

// The one way a student profile is created outside the CLI/sandbox: a person who signed in (Google or an
// emailed code) confirms they are 18 or older and accepts the privacy notice. Both are recorded on the
// profile (age_confirmed_at, privacy_notice_version). Without that the account reaches nothing.
//
// Never for: team accounts (any admin_members row, even revoked), users who already have or had a
// profile (suspended or erased stay that way), accounts whose email was never verified (the CLI
// creates staff unverified; every student sign-in method verifies it), or while sign-up is closed.

// Recorded on the profile as the consent record: which notice the student accepted, and when (created_at).
// Change it whenever /privacy changes in substance, so consent can be traced to the exact text.
export const PRIVACY_NOTICE_VERSION = 'student-2026-11-13'

const ELIGIBLE = `SELECT u.id, u.name,
         (SELECT COUNT(*) FROM admin_members m WHERE m.user_id = u.id) AS memberships,
         (SELECT COUNT(*) FROM student_profiles s WHERE s.user_id = u.id) AS profiles,
         u.emailVerified AS verified
    FROM auth_user u WHERE u.id = ?`

export async function canStartStudentProfile(userId: string, db: Pick<ReturnType<typeof getAdminPool>, 'query'> = getAdminPool()): Promise<boolean> {
  if (!newAccountsAllowed()) return false
  const [rows] = await db.query<RowDataPacket[]>(ELIGIBLE, [userId])
  const r = rows[0]
  return Boolean(r) && Number(r.memberships) === 0 && Number(r.profiles) === 0 && Number(r.verified) === 1
}

export type OnboardingResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Creates the profile after the privacy acknowledgement and an 18+ confirmation: the attestation made
 * on /age-confirm before this account existed (D-045), or, for an older account without one, the tick
 * sent here. Idempotent per user.
 */
export async function createStudentProfile(
  userId: string,
  input: { ageConfirmed?: unknown; privacyAccepted?: unknown; displayName?: unknown },
): Promise<OnboardingResult> {
  const pool = getAdminPool()
  const attestation = await ageAttestation(userId, pool)
  if ((!attestation && input.ageConfirmed !== true) || input.privacyAccepted !== true)
    return { ok: false, status: 400, error: 'Confirm that you are 18 or older and accept the privacy notice to continue.' }
  const chosenName = input.displayName === undefined || input.displayName === '' ? null : normalizeFullName(input.displayName)
  if (input.displayName !== undefined && input.displayName !== '' && !chosenName) return { ok: false, status: 400, error: 'Enter your full name, using letters only.' }
  if (!(await canStartStudentProfile(userId, pool))) return { ok: false, status: 403, error: 'This account cannot create a student profile.' }
  const [rows] = await pool.query<RowDataPacket[]>('SELECT name FROM auth_user WHERE id = ?', [userId])
  // The name typed here, else the one given on /age-confirm, else the provider's (Google). An account made
  // with an emailed code has none yet, so the person must give one.
  const name = chosenName ?? attestation?.fullName ?? (String(rows[0]?.name ?? '').trim().slice(0, 120) || null)
  if (!name) return { ok: false, status: 400, error: 'Enter your full name, using letters only.' }
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
