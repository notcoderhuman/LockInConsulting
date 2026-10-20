// Account policies, kept separate and explicit so each can be tested on its own.
//
//   administrator  — an owner. Provisioned only with scripts/admin-user.mjs. No sign-up route.
//   team member    — an editor or reviewer. Same CLI provisioning; an owner may later revoke them
//                    or (for editors) grant support access from /admin/team, never escalate a role.
//   student        — a student_profiles row. Sign-up stays DISABLED: Better Auth's
//                    /sign-up/email path is switched off for everyone (lib/auth-options.mjs), and
//                    the student area fails closed unless STUDENT_ACCOUNTS_ENABLED=true, which must
//                    not be set until the age-eligibility, privacy-notice, data-handling and Indian
//                    legal/privacy review is complete (RISKS.md R-026).
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
// None is operational. A provider would only move to `credentials_supplied_untested` when its
// variables are present; it is never wired into Better Auth by this code. Declaring one
// operational needs its callback registered, tested on staging, and the code changed on purpose.

export type ProviderId = 'google' | 'microsoft' | 'apple' | 'yahoo'

export type ProviderStatus =
  | { id: ProviderId; label: string; state: 'not_configured'; detail: string }
  | { id: ProviderId; label: string; state: 'credentials_supplied_untested'; detail: string }
  | { id: ProviderId; label: string; state: 'deferred'; detail: string }

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
    if (vars.every((v) => (env[v] ?? '').length > 0))
      return { id, label, state: 'credentials_supplied_untested', detail: 'Credentials are present but the provider is not connected or tested. Sign-in with it is unavailable.' }
    return { id, label, state: 'not_configured', detail: 'No OAuth credentials or callback have been supplied. Sign-in with it is unavailable.' }
  })
}

// ---- Student area gate ---------------------------------------------------------------------

export type StudentAreaStatus = { enabled: true } | { enabled: false; reason: 'student_accounts_disabled' | 'auth_not_configured' }

/** The student chat is reachable only when explicitly enabled AND admin auth itself is configured. */
export function getStudentAreaStatus(env: Env = process.env, authConfigured: boolean): StudentAreaStatus {
  if (env.STUDENT_ACCOUNTS_ENABLED !== 'true') return { enabled: false, reason: 'student_accounts_disabled' }
  if (!authConfigured) return { enabled: false, reason: 'auth_not_configured' }
  return { enabled: true }
}
