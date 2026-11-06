import 'server-only'
import { betterAuth } from 'better-auth'
import { emailOTP, genericOAuth } from 'better-auth/plugins'
import { getAdminConfigStatus, resolveAuthBaseUrl } from '@/lib/admin/config'
import { getAuthPool } from '@/lib/db/pool'
import { AUTH_MODELS, DISABLED_AUTH_PATHS, PASSWORD_POLICY, RATE_LIMIT } from '@/lib/auth-options.mjs'
import { OTP_ALLOWED_ATTEMPTS, OTP_TTL_SECONDS, otpHasher } from '@/lib/auth-otp'
import { authIpAddressOptions } from '@/lib/auth-throttle'
import { emailOtpOpen, newAccountsAllowed, providerSignInOpen, studentEmailAllowed, testerMode } from '@/lib/identity/policy'
import { mailer, otpMessage } from '@/lib/mail'
import { AGE_COOKIE, ageTokenFrom, bindAgeAttestation, consumeAgeAttestation, revokeAgeAttestation } from '@/lib/student/age-attestation'

// Shared by every student sign-in provider; read at construction, so a switch change needs a restart.
const socialCommon = () => ({
  disableIdTokenSignIn: true,
  requireEmailVerification: true,
  disableImplicitSignUp: true,
  disableSignUp: !newAccountsAllowed(),
})

async function emailOf(userId: string): Promise<string | null> {
  const [rows] = await getAuthPool().query('SELECT email FROM auth_user WHERE id = ?', [userId])
  return (rows as { email: string }[])[0]?.email ?? null
}

async function isStaff(userId: string): Promise<boolean> {
  const [rows] = await getAuthPool().query('SELECT 1 FROM admin_members WHERE user_id = ? LIMIT 1', [userId])
  return (rows as unknown[]).length > 0
}

/** Sign-in routes that exist only for students: an emailed code or a provider callback. */
export const isStudentOnlyPath = (path: string | undefined) => !!path && (path === '/sign-in/email-otp' || path.startsWith('/callback/'))

/** Exported so tests can check the real cookie attributes for an https staging origin. */
export function createAuth(baseURL = resolveAuthBaseUrl()) {
  return betterAuth({
    database: getAuthPool(),
    baseURL,
    ...AUTH_MODELS,
    rateLimit: RATE_LIMIT as never,
    disabledPaths: DISABLED_AUTH_PATHS,
    emailAndPassword: {
      enabled: true,
      // Administrators are provisioned only by scripts/admin-user.mjs. There is no sign-up route.
      disableSignUp: true,
      ...PASSWORD_POLICY,
      revokeSessionsOnPasswordReset: true,
    },
    // Student sign-in with Google, Microsoft, Apple and (below, through genericOAuth) Yahoo: each only
    // when its credentials are set AND student accounts are open (server-side env only; no secret
    // reaches the browser). While closed it is not registered at all, so no sign-in can start.
    // Callbacks: <BETTER_AUTH_URL>/api/auth/callback/<provider>. Setup: docs/AUTH-PROVIDERS.md.
    //   - Better Auth's own state + PKCE checks protect the redirect; ID-token sign-in from the
    //     browser is off, so the only way in is the full server-side code exchange.
    //   - Identity scopes only; extra scopes from the browser are refused in app/api/auth/[...all]/route.ts.
    //   - The provider must report the email as verified (user.create.before refuses it otherwise).
    //     Microsoft reports it only with the verified_primary_email optional claim configured.
    //   - No implicit sign-up: a new account is created only when the sign-in button asks for it
    //     AND STUDENT_SELF_SIGNUP_ENABLED (with STUDENT_ACCOUNTS_ENABLED) is on. Even then the
    //     account has no student profile until the 18+ and privacy confirmation (lib/student/onboarding.ts).
    socialProviders: {
      ...(providerSignInOpen('google')
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
              prompt: 'select_account' as const,
              // Exactly openid, email and profile; never earlier grants folded in.
              disableDefaultScope: true,
              scope: ['openid', 'email', 'profile'],
              includeGrantedScopes: false,
              ...socialCommon(),
            },
          }
        : {}),
      ...(providerSignInOpen('microsoft')
        ? {
            microsoft: {
              clientId: process.env.MICROSOFT_CLIENT_ID!.trim(),
              clientSecret: process.env.MICROSOFT_CLIENT_SECRET!.trim(),
              // "common": personal Microsoft accounts (Outlook, Hotmail, Live) and work or school accounts.
              tenantId: 'common',
              prompt: 'select_account' as const,
              disableDefaultScope: true,
              scope: ['openid', 'email', 'profile'],
              disableProfilePhoto: true,
              ...socialCommon(),
            },
          }
        : {}),
      ...(providerSignInOpen('apple')
        ? {
            apple: {
              clientId: process.env.APPLE_CLIENT_ID!.trim(),
              // The signed client-secret JWT: valid at most 6 months, so it must be regenerated before then.
              clientSecret: process.env.APPLE_CLIENT_SECRET!.trim(),
              disableDefaultScope: true,
              scope: ['name', 'email'],
              ...socialCommon(),
            },
          }
        : {}),
    },
    plugins: [
      // Yahoo has no built-in provider: plain OpenID Connect through its discovery document.
      ...(providerSignInOpen('yahoo')
        ? [
            genericOAuth({
              config: [
                {
                  providerId: 'yahoo',
                  clientId: process.env.YAHOO_CLIENT_ID!.trim(),
                  clientSecret: process.env.YAHOO_CLIENT_SECRET!.trim(),
                  discoveryUrl: 'https://api.login.yahoo.com/.well-known/openid-configuration',
                  scopes: ['openid', 'email', 'profile'],
                  pkce: true,
                  ...socialCommon(),
                },
              ],
            }),
          ]
        : []),
      // Emailed one-time codes for students: sign-in, sign-up (same 18+ gate below) and password
      // recovery. Limits, staff exclusion and resend handling: lib/auth-otp.ts.
      ...(emailOtpOpen()
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: OTP_TTL_SECONDS,
              allowedAttempts: OTP_ALLOWED_ATTEMPTS,
              storeOTP: { hash: otpHasher(process.env.BETTER_AUTH_SECRET ?? '') },
              disableSignUp: !newAccountsAllowed(),
              async sendVerificationOTP({ email, otp, type }) {
                await mailer.send(otpMessage(email, otp, type, OTP_TTL_SECONDS / 60))
              },
            }),
          ]
        : []),
    ],
    // Adding a second sign-in method to a student account: only when the provider says the email is
    // verified AND the account's own email is verified, never to a different email, and no provider
    // is trusted by name. Staff accounts can never gain one (databaseHooks.account below).
    account: {
      ...AUTH_MODELS.account,
      accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false, requireLocalEmailVerified: true, updateUserInfoOnLink: false },
      // Provider tokens are never used by the app; stored encrypted with BETTER_AUTH_SECRET (PRODUCTION-READINESS S-3).
      encryptOAuthTokens: true,
    },
    // D-045: this instance creates users only through student sign-up (a provider or an emailed code;
    // password sign-up is disabled; staff are created by scripts/admin-user.mjs with its own instance). A new account needs an
    // unspent 18+ attestation from /age-confirm, consumed here exactly once; without it Better Auth
    // creates nothing and redirects with error=unable_to_create_user. Existing users never reach this.
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const token = ageTokenFrom(ctx?.headers?.get('cookie'))
            // Better Auth inserts the user BEFORE it applies requireEmailVerification, so an unverified
            // provider identity would leave an auth_user row behind. Refuse it here instead, and spend
            // the confirmation so the failed attempt cannot be replayed.
            // Pre-launch tester mode: only listed addresses may get an account (lib/identity/policy.ts).
            if (user.emailVerified !== true || !studentEmailAllowed(user.email)) {
              await revokeAgeAttestation(token)
              return false
            }
            return consumeAgeAttestation(token)
          },
          after: async (user, ctx) => {
            await bindAgeAttestation(ageTokenFrom(ctx?.headers?.get('cookie')), user.id)
            ctx?.setCookie(AGE_COOKIE, '', { path: '/', maxAge: 0 })
          },
        },
      },
      // Staff sign in only with email and password. Even if a provider or a code reaches a staff
      // email, no other sign-in method is attached to the account and no session is opened that way.
      account: {
        create: {
          before: async (account) => (account.providerId !== 'credential' && (await isStaff(account.userId)) ? false : undefined),
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const staff = await isStaff(session.userId)
            if (staff && isStudentOnlyPath(ctx?.path)) return false
            // Tester mode: no session at all for an unlisted student, whichever way they sign in.
            if (!staff && testerMode() && !studentEmailAllowed(await emailOf(session.userId))) return false
            return undefined
          },
        },
      },
    },
    // OAuth failures that happen before the caller's error page is known land on the student page.
    onAPIError: { errorURL: `${baseURL ?? ''}/auth` },
    trustedOrigins: [
      // Apple returns to the callback with a cross-site form POST.
      ...(providerSignInOpen('apple') ? ['https://appleid.apple.com'] : []),
      ...(process.env.NODE_ENV === 'development'
        ? [
            'http://localhost:3000',
            ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
            ...(process.env.V0_DEV_APP_URL ? [process.env.V0_DEV_APP_URL] : []),
            ...(process.env.V0_BUILD_URL ? [process.env.V0_BUILD_URL] : []),
            ...(process.env.V0_SANDBOX_URL ? [process.env.V0_SANDBOX_URL] : []),
          ]
        : []),
      ...(process.env.NODE_ENV === 'production'
        ? [
            ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
            ...(process.env.VERCEL_PROJECT_PRODUCTION_URL ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`] : []),
          ]
        : []),
    ],
    advanced: {
      // Client IP only from an explicitly trusted proxy header (lib/auth-throttle.ts).
      ipAddress: authIpAddressOptions(),
      ...(process.env.NODE_ENV === 'development'
        ? {
            // Required by the cross-site v0 preview iframe. Without these
            // attributes, login succeeds but the next request appears signed out.
            defaultCookieAttributes: {
              sameSite: 'none' as const,
              secure: true,
            },
          }
        : {}),
    },
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined

/** Returns null (fail closed) when the secret, database or base URL is missing or invalid. */
export function getAuth(): Auth | null {
  if (!getAdminConfigStatus().ok) return null
  instance ??= createAuth()
  return instance
}
