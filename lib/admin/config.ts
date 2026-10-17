type Env = Record<string, string | undefined>

export type AdminConfigStatus = { ok: true; baseURL: string } | { ok: false; problems: string[] }

export function resolveAuthBaseUrl(env: Env = process.env): string | undefined {
  return (
    env.BETTER_AUTH_URL ??
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : env.VERCEL_URL
        ? `https://${env.VERCEL_URL}`
        : env.V0_RUNTIME_URL)
  )
}

const LOCALHOST = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The admin area fails closed: if anything here is wrong, every admin page, API route and
 * server action refuses to run, and Better Auth is never constructed with a default secret.
 */
export function getAdminConfigStatus(env: Env = process.env): AdminConfigStatus {
  const problems: string[] = []

  if (env.ADMIN_DISABLED === 'true') problems.push('ADMIN_DISABLED is set')

  const secret = env.BETTER_AUTH_SECRET ?? ''
  if (secret.length < 32) problems.push('BETTER_AUTH_SECRET must be set (at least 32 characters)')

  if (!env.ADMIN_DATABASE_URL && !env.DATABASE_URL) problems.push('ADMIN_DATABASE_URL or DATABASE_URL must be set')

  const baseURL = resolveAuthBaseUrl(env)
  if (!baseURL) {
    problems.push('BETTER_AUTH_URL must be set')
  } else {
    let url: URL | null = null
    try {
      url = new URL(baseURL)
    } catch {
      problems.push('BETTER_AUTH_URL is not a valid URL')
    }
    if (url && env.NODE_ENV === 'production' && url.protocol !== 'https:' && !LOCALHOST.has(url.hostname))
      problems.push('BETTER_AUTH_URL must use https in production')
  }

  return problems.length ? { ok: false, problems } : { ok: true, baseURL: baseURL! }
}
