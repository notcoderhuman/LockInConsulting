import 'server-only'
import { betterAuth } from 'better-auth'
import { getAdminConfigStatus, resolveAuthBaseUrl } from '@/lib/admin/config'
import { getAuthPool } from '@/lib/db/pool'
import { AUTH_MODELS, DISABLED_AUTH_PATHS, PASSWORD_POLICY, RATE_LIMIT } from '@/lib/auth-options.mjs'
import { authIpAddressOptions } from '@/lib/auth-throttle'
import { googleSignInOpen, studentSignUpOpen } from '@/lib/identity/policy'
import { AGE_COOKIE, ageTokenFrom, bindAgeAttestation, consumeAgeAttestation, revokeAgeAttestation } from '@/lib/student/age-attestation'

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
    // Google sign-in for students, only when both credentials are set AND student accounts are open
    // (server-side env only; the secret never reaches the browser). While accounts are closed it is
    // not registered at all, so no sign-in can start. Callback: <BETTER_AUTH_URL>/api/auth/callback/google.
    //   - Better Auth's own state + PKCE checks protect the redirect; ID-token sign-in from the
    //     browser is off, so the only way in is the full server-side code exchange.
    //   - Google must report the email as verified.
    //   - No implicit sign-up: a new account is created only when the sign-in button asks for it
    //     AND STUDENT_SELF_SIGNUP_ENABLED (with STUDENT_ACCOUNTS_ENABLED) is on. Even then the
    //     account has no student profile until the 18+ and privacy confirmation (lib/student/onboarding.ts).
    //   - Account linking stays off (AUTH_MODELS): an existing email-and-password account, such as a
    //     team member's, can never be entered through Google ("account_not_linked").
    // Microsoft and Yahoo are not configured; Apple is excluded (paid developer membership).
    ...(googleSignInOpen()
      ? {
          socialProviders: {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
              prompt: 'select_account' as const,
              // Identity only: exactly openid, email and profile. Never earlier grants folded in, and
              // never extra scopes from the browser (refused in app/api/auth/[...all]/route.ts).
              disableDefaultScope: true,
              scope: ['openid', 'email', 'profile'],
              includeGrantedScopes: false,
              disableIdTokenSignIn: true,
              requireEmailVerification: true,
              disableImplicitSignUp: true,
              disableSignUp: !studentSignUpOpen(),
            },
          },
        }
      : {}),
    // D-045: this instance creates users only through Google sign-up (email sign-up is disabled;
    // staff are created by scripts/admin-user.mjs with its own instance). A new account needs an
    // unspent 18+ attestation from /age-confirm, consumed here exactly once; without it Better Auth
    // creates nothing and redirects with error=unable_to_create_user. Existing users never reach this.
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const token = ageTokenFrom(ctx?.headers?.get('cookie'))
            // Better Auth inserts the user BEFORE it applies requireEmailVerification, so an unverified
            // Google identity would leave an auth_user row behind. Refuse it here instead, and spend
            // the confirmation so the failed attempt cannot be replayed.
            if (user.emailVerified !== true) {
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
    },
    // OAuth failures that happen before the caller's error page is known land on the student page.
    onAPIError: { errorURL: `${baseURL ?? ''}/auth` },
    trustedOrigins: [
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
