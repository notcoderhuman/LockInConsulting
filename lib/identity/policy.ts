// Account policies, kept separate and explicit so each can be tested on its own.
//
//   administrator  — an owner. Provisioned only with scripts/admin-user.mjs. No sign-up route.
//   team member    — an editor or reviewer. Same CLI provisioning; an owner may later revoke them
//                    or (for editors) grant support access from /admin/team, never escalate a role.
//   student        — a student_profiles row. Email sign-up stays DISABLED: Better Auth's
//                    /sign-up/email path is switched off for everyone (lib/auth-options.mjs), and
//                    the student area fails closed unless STUDENT_ACCOUNTS_ENABLED=true, which must
//                    not be set until the age-eligibility, privacy-notice, data-handling and Indian
//                    legal/privacy review is complete (RISKS.md R-026).
//                    Google sign-in (lib/auth.ts) can create a NEW account only when, in addition,
//                    STUDENT_SELF_SIGNUP_ENABLED=true; even then the account has no student profile
//                    (and no access) until the person confirms they are 18 or older and accepts the
//                    privacy notice (lib/student/onboarding.ts). It never grants a team role.
//
// One auth_user can never be both staff and a student: lib/admin/access.ts refuses a user with a
// student profile and lib/student/access.ts refuses a user with an admin membership.

type Env = Record<string, string | undefined>

export type AccountKind = 'administrator' | 'team_member' | 'student'

export interface AccountPolicy {
  kind: AccountKind
  provisioning: 'cli_only' | 'disabled'
  selfSignUp: false
  sessionHours: number
  description: string
}

export const ACCOUNT_POLICIES: Record<AccountKind, AccountPolicy> = {
  administrator: {
    kind: 'administrator',
    provisioning: 'cli_only',
    selfSignUp: false,
    sessionHours: 8,
    description: 'Owner accounts, created only with `pnpm admin:user create --role owner` on a trusted machine.',
  },
  team_member: {
    kind: 'team_member',
    provisioning: 'cli_only',
    selfSignUp: false,
    sessionHours: 8,
    description: 'Editors and reviewers, created only from the CLI. Owners may revoke them or delegate support access in /admin/team.',
  },
  student: {
    kind: 'student',
    provisioning: 'disabled',
    selfSignUp: false,
    sessionHours: 8,
    description: 'Student accounts are not open. Sign-up stays disabled until the legal and privacy review is complete.',
  },
}

// ---- Identity providers --------------------------------------------------------------------
// Google is wired into Better Auth (lib/auth.ts) for STUDENTS when GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET are both set; staff still sign in only with email and password. The others
// only move to `credentials_supplied_untested` when their variables are present and are never
// wired in: declaring one operational needs its callback registered, tested, and code changed.

export type ProviderId = 'google' | 'microsoft' | 'apple' | 'yahoo'

export type ProviderStatus =
  | { id: ProviderId; label: string; state: 'not_configured'; detail: string }
  | { id: ProviderId; label: string; state: 'credentials_supplied_untested'; detail: string }
  | { id: ProviderId; label: string; state: 'deferred'; detail: string }
  | { id: ProviderId; label: string; state: 'closed'; detail: string }
  | { id: ProviderId; label: string; state: 'available'; detail: string }

const PROVIDERS: { id: ProviderId; label: string; vars: string[] }[] = [
  { id: 'google', label: 'Google', vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  // Outlook / Hotmail accounts sign in through the Microsoft identity platform.
  { id: 'microsoft', label: 'Microsoft (Outlook)', vars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'] },
  { id: 'yahoo', label: 'Yahoo', vars: ['YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET'] },
  { id: 'apple', label: 'Apple', vars: [] },
]

export function getIdentityProviderStatus(env: Env = process.env): ProviderStatus[] {
  return PROVIDERS.map(({ id, label, vars }) => {
    if (id === 'apple')
      return { id, label, state: 'deferred', detail: 'Deferred until the Apple Developer Program cost is explicitly approved.' }
    if (id === 'google' && googleSignInOpen(env))
      return { id, label, state: 'available', detail: 'Students can sign in with Google. Callback: <BETTER_AUTH_URL>/api/auth/callback/google.' }
    if (id === 'google' && googleConfigured(env))
      // Shown to students on /auth, so it names no setting; Settings has its own label for this state.
      return { id, label, state: 'closed', detail: 'Google sign-in opens when student accounts open.' }
    if (vars.every((v) => (env[v] ?? '').trim().length > 0))
      return { id, label, state: 'credentials_supplied_untested', detail: 'Credentials are present but the provider is not connected or tested. Sign-in with it is unavailable.' }
    return { id, label, state: 'not_configured', detail: 'No OAuth credentials or callback have been supplied. Sign-in with it is unavailable.' }
  })
}

/** Both Google credentials are present (values are never read beyond "is it set"). */
export function googleConfigured(env: Env = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim())
}

/** Google is offered to students, and wired into Better Auth, only while the student area is open. */
export function googleSignInOpen(env: Env = process.env): boolean {
  return googleConfigured(env) && env.STUDENT_ACCOUNTS_ENABLED === 'true'
}

/** The published student privacy notice: an https URL or a same-site path, else null (RISKS.md R-026). */
export function privacyNoticeUrl(env: Env = process.env): string | null {
  const v = env.STUDENT_PRIVACY_NOTICE_URL?.trim() ?? ''
  if (v.startsWith('/') && !v.startsWith('//')) return v
  try {
    return new URL(v).protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

/**
 * New student accounts (via Google) may be created: the student area AND self sign-up are on, and in
 * production a privacy notice is published (STUDENT_PRIVACY_NOTICE_URL), so the 18+ and privacy step
 * always has a full notice to link to. The flags alone never open production sign-up.
 */
export function studentSignUpOpen(env: Env = process.env): boolean {
  return (
    env.STUDENT_ACCOUNTS_ENABLED === 'true' &&
    env.STUDENT_SELF_SIGNUP_ENABLED === 'true' &&
    (env.NODE_ENV !== 'production' || privacyNoticeUrl(env) !== null)
  )
}

// ---- Student area gate ---------------------------------------------------------------------

export type StudentAreaStatus = { enabled: true } | { enabled: false; reason: 'student_accounts_disabled' | 'auth_not_configured' }

/** The student chat is reachable only when explicitly enabled AND admin auth itself is configured. */
export function getStudentAreaStatus(env: Env = process.env, authConfigured: boolean): StudentAreaStatus {
  if (env.STUDENT_ACCOUNTS_ENABLED !== 'true') return { enabled: false, reason: 'student_accounts_disabled' }
  if (!authConfigured) return { enabled: false, reason: 'auth_not_configured' }
  return { enabled: true }
}
