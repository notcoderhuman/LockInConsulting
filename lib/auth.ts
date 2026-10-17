import 'server-only'
import { betterAuth } from 'better-auth'
import { getAdminConfigStatus, resolveAuthBaseUrl } from '@/lib/admin/config'
import { getAuthPool } from '@/lib/db/pool'
import { AUTH_MODELS, DISABLED_AUTH_PATHS, PASSWORD_POLICY, RATE_LIMIT } from '@/lib/auth-options.mjs'

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
    // Google / Microsoft sign-in are not configured: no credentials or callback URLs have been
    // supplied. Apple is excluded (paid developer membership). See ARCHITECTURE.md → Auth.
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
    ...(process.env.NODE_ENV === 'development'
      ? {
          advanced: {
            // Required by the cross-site v0 preview iframe. Without these
            // attributes, login succeeds but the next request appears signed out.
            defaultCookieAttributes: {
              sameSite: 'none' as const,
              secure: true,
            },
          },
        }
      : {}),
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
