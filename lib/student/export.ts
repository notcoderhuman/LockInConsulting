import 'server-only'
import type { RowDataPacket } from 'mysql2/promise'
import type { getAdminPool } from '@/lib/db/pool'
import type { StudentActor } from '@/lib/student/access'
import { exportStudentConversations } from '@/lib/support/conversations'

// "Download my data": a summary of the personal data LockIn holds about the signed-in student and
// who processes it (DPDP Act 2023 s.11(1)). Only the session's own records; never secrets such as
// password hashes, session tokens, provider tokens or hashed codes.

type Db = Pick<ReturnType<typeof getAdminPool>, 'query'>

// Keep in step with /privacy "Who else processes your data".
export const PROCESSORS = [
  { name: 'Hostinger', role: 'Hosts the website and database' },
  { name: 'Google (Gemini API)', role: 'Drafts replies labelled as Derek’s, when Derek is switched on' },
  { name: 'Your sign-in provider (Google, Microsoft, Apple or Yahoo), if you use one', role: 'Confirms who you are when you sign in' },
  { name: 'LockIn’s email delivery provider', role: 'Sends sign-in and password-reset codes' },
]

const s = (v: unknown) => (v == null ? null : String(v))

export async function exportStudentData(db: Db, student: StudentActor) {
  const q = async (sql: string, params: unknown[]) => (await db.query<RowDataPacket[]>(sql, params))[0]
  const [user] = await q('SELECT email, name, emailVerified, createdAt FROM auth_user WHERE id = ?', [student.userId])
  const [profile] = await q('SELECT display_name, status, created_at, age_confirmed_at, privacy_notice_version FROM student_profiles WHERE id = ?', [student.profileId])
  const methods = await q('SELECT providerId, createdAt FROM auth_account WHERE userId = ? ORDER BY createdAt', [student.userId])
  const sessions = await q('SELECT createdAt, expiresAt, userAgent FROM auth_session WHERE userId = ? AND expiresAt > UTC_TIMESTAMP(3) ORDER BY createdAt', [student.userId])
  const [attestation] = await q('SELECT confirmed_at, policy_version FROM student_age_attestations WHERE user_id = ? AND consumed_at IS NOT NULL', [student.userId])
  return {
    exportedAt: new Date().toISOString(),
    account: { email: s(user?.email), nameFromSignIn: s(user?.name), emailVerified: Number(user?.emailVerified) === 1, createdAt: s(user?.createdAt) },
    profile: {
      displayName: s(profile?.display_name),
      status: s(profile?.status),
      createdAt: s(profile?.created_at),
      ageConfirmedAt: s(profile?.age_confirmed_at),
      privacyNoticeAccepted: s(profile?.privacy_notice_version),
    },
    ageConfirmation: attestation ? { confirmedAt: s(attestation.confirmed_at), policyVersion: s(attestation.policy_version) } : null,
    signInMethods: methods.map((m) => ({ method: String(m.providerId) === 'credential' ? 'email and password' : String(m.providerId), addedAt: s(m.createdAt) })),
    activeSessions: sessions.map((x) => ({ signedInAt: s(x.createdAt), expiresAt: s(x.expiresAt), browser: s(x.userAgent) })),
    conversations: await exportStudentConversations(db, student),
    processors: PROCESSORS,
  }
}
