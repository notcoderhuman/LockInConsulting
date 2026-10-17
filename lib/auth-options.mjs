// Shared by lib/auth.ts (the app) and scripts/admin-user.mjs (provisioning) so both always agree
// on table names, password policy and session lifetime. Plain JS so the Node script can import it.

export const AUTH_MODELS = {
  user: { modelName: 'auth_user' },
  session: {
    modelName: 'auth_session',
    // Admin sessions: 8 h, extended at most once an hour while in use. No cookie cache, so
    // revoking a session or a membership takes effect on the very next request.
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
    freshAge: 60 * 15,
  },
  account: { modelName: 'auth_account', accountLinking: { enabled: false } },
  verification: { modelName: 'auth_verification' },
}

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

// Endpoints the admin never needs. Disabling them shrinks the attack surface: there is no public
// sign-up, no self-service account deletion and no email-based flows (no email is configured).
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
]
