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
//                    Google, Microsoft, Apple, Yahoo or an emailed one-time code (lib/auth.ts) can
//                    create a NEW account only when, in addition, STUDENT_SELF_SIGNUP_ENABLED=true; even then the account has no student profile
//                    (and no access) until the person confirms they are 18 or older and accepts the
//                    privacy notice (lib/student/onboarding.ts). It never grants a team role.
//
// One auth_user can never be both staff and a student: lib/admin/access.ts refuses a user with a
// student profile and lib/student/access.ts refuses a user with an admin membership.

import { noticeReady } from '@/lib/legal/notice'

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
    sessionHours: 24 * 30,
    description: 'Student accounts are not open. Sign-up stays disabled until the legal and privacy review is complete.',
  },
}

// ---- Identity providers --------------------------------------------------------------------
// Students may sign in with Google, Microsoft (personal and work or school accounts), Apple and
// Yahoo, each wired into Better Auth (lib/auth.ts) only when its credentials are set AND the student
// area is open. Staff still sign in only with email and password. Setup: docs/AUTH-PROVIDERS.md.

export type ProviderId = 'google' | 'microsoft' | 'apple' | 'yahoo'

export type ProviderStatus =
  | { id: ProviderId; label: string; state: 'not_configured'; detail: string }
  | { id: ProviderId; label: string; state: 'closed'; detail: string }
  | { id: ProviderId; label: string; state: 'available'; detail: string }

export const PROVIDERS: { id: ProviderId; label: string; vars: string[] }[] = [
  { id: 'google', label: 'Google', vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  // Outlook / Hotmail and work or school accounts sign in through the Microsoft identity platform.
  { id: 'microsoft', label: 'Microsoft', vars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'] },
  { id: 'yahoo', label: 'Yahoo', vars: ['YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET'] },
  // Needs the paid Apple Developer Program; APPLE_CLIENT_SECRET is the signed client-secret JWT.
  { id: 'apple', label: 'Apple', vars: ['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'] },
]

/** Every credential for this provider is present (values are never read beyond "is it set"). */
export function providerConfigured(id: ProviderId, env: Env = process.env): boolean {
  return PROVIDERS.find((p) => p.id === id)!.vars.every((v) => (env[v] ?? '').trim().length > 0)
}

/** The provider is offered to students, and wired into Better Auth, only while the student area is open. */
export function providerSignInOpen(id: ProviderId, env: Env = process.env): boolean {
  return providerConfigured(id, env) && env.STUDENT_ACCOUNTS_ENABLED === 'true'
}

export function getIdentityProviderStatus(env: Env = process.env): ProviderStatus[] {
  return PROVIDERS.map(({ id, label }) => {
    if (providerSignInOpen(id, env)) return { id, label, state: 'available', detail: `Students can sign in with ${label}.` }
    // Shown to students on /auth, so it names no setting; Settings has its own label for this state.
    if (providerConfigured(id, env)) return { id, label, state: 'closed', detail: `${label} sign-in opens when student accounts open.` }
    return { id, label, state: 'not_configured', detail: 'Not set up yet. Sign-in with it is unavailable.' }
  })
}

export const googleConfigured = (env: Env = process.env) => providerConfigured('google', env)
export const googleSignInOpen = (env: Env = process.env) => providerSignInOpen('google', env)

/** Outgoing mail is configured (lib/mail.ts): SMTP host, sender and credentials, or the local log transport. */
export function mailConfigured(env: Env = process.env): boolean {
  if (env.MAIL_TRANSPORT === 'log') return env.NODE_ENV !== 'production'
  return ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'].every((v) => (env[v] ?? '').trim().length > 0)
}

/** Email one-time codes (sign-in, sign-up, password reset) for students: student area open and mail configured. */
export function emailOtpOpen(env: Env = process.env): boolean {
  return env.STUDENT_ACCOUNTS_ENABLED === 'true' && mailConfigured(env)
}

/** Some way to create a new student account exists: a social provider or email codes. */
export function signUpMethodAvailable(env: Env = process.env): boolean {
  return emailOtpOpen(env) || PROVIDERS.some((p) => providerConfigured(p.id, env))
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
 * New student accounts may be created: the student area AND self sign-up are on, and in production
 * STUDENT_PRIVACY_NOTICE_URL is this site's own /privacy and that notice is complete: reviewed, with
 * every business contact detail filled in (lib/legal/notice.ts). An external notice cannot be checked,
 * so it never opens production sign-up. The flags alone never open it either (R-026).
 */
export function studentSignUpOpen(env: Env = process.env, noticeComplete: boolean = noticeReady()): boolean {
  return (
    env.STUDENT_ACCOUNTS_ENABLED === 'true' &&
    env.STUDENT_SELF_SIGNUP_ENABLED === 'true' &&
    (env.NODE_ENV !== 'production' || (privacyNoticeUrl(env) === '/privacy' && noticeComplete))
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
