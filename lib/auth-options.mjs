// Shared by lib/auth.ts (the app) and scripts/admin-user.mjs (provisioning) so both always agree
// on table names, password policy and session lifetime. Plain JS so the Node script can import it.

export const AUTH_MODELS = {
  user: { modelName: 'auth_user' },
  session: {
    modelName: 'auth_session',
    // Student sessions: 30 days, extended at most once a day while in use (an active student stays
    // signed in). Staff sessions end STAFF_SESSION_SECONDS after sign-in whatever this says: the admin
    // access check revokes older ones (lib/admin/access.ts). No cookie cache, so revoking a session
    // or a membership takes effect on the very next request.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
  },
  account: { modelName: 'auth_account', accountLinking: { enabled: false } },
  verification: { modelName: 'auth_verification' },
}

// Staff: 8 h from sign-in, absolute (no extension by activity).
export const STAFF_SESSION_SECONDS = 60 * 60 * 8

export const PASSWORD_POLICY = { minPasswordLength: 12, maxPasswordLength: 128 }

export const RATE_LIMIT = {
  enabled: true,
  storage: 'database',
  modelName: 'auth_rate_limit',
  window: 60,
  max: 60,
  customRules: {
    '/sign-in/email': { window: 300, max: 5 },
  },
}

// Endpoints nobody needs. Disabling them shrinks the attack surface: there is no password sign-up,
// no Better Auth self-service deletion (student erasure has its own audited path) and no
// link-based email flows. Students' emailed codes use only the emailOTP endpoints that
// lib/auth-otp.ts guards; the rest of that plugin is listed here.
export const DISABLED_AUTH_PATHS = [
  '/sign-up/email',
  '/delete-user',
  '/change-email',
  '/update-user',
  '/request-password-reset',
  '/reset-password',
  '/forget-password',
  '/send-verification-email',
  '/verify-email',
  // Password checks outside the throttled /sign-in/email: passwords change only through
  // `scripts/admin-user.mjs set-password`, so a stolen session cannot be used to guess one.
  '/change-password',
  '/verify-password',
  // emailOTP: emails are always verified at sign-up, email changes are not offered, and
  // check-verification-otp would be a guessing oracle. /forget-password/email-otp duplicates
  // /email-otp/request-password-reset.
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/forget-password/email-otp',
]
