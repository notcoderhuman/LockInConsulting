import { toNextJsHandler } from 'better-auth/next-js'
import { resolveAuthBaseUrl } from '@/lib/admin/config'
import { getAuth } from '@/lib/auth'
import { throttleEmailSignIn } from '@/lib/auth-throttle'
import { getAuthPool } from '@/lib/db/pool'

// Fails closed: without a valid secret, database and base URL, Better Auth is never constructed
// (so it can't fall back to a default secret) and every auth endpoint returns 503.

function unavailable() {
  return Response.json({ error: 'Authentication is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
}

/** A person coming back from Google gets a readable page, not a JSON error. */
function callbackFailed(request: Request) {
  const url = new URL('/auth', resolveAuthBaseUrl() ?? new URL(request.url).origin)
  url.searchParams.set('error', 'unavailable')
  return Response.redirect(url, 302)
}

export async function GET(request: Request) {
  const auth = getAuth()
  const isCallback = new URL(request.url).pathname.includes('/callback/')
  if (!auth) return isCallback ? callbackFailed(request) : unavailable()
  if (!isCallback) return toNextJsHandler(auth).GET(request)
  try {
    const response = await toNextJsHandler(auth).GET(request)
    // e.g. the database is unreachable while the account or session is written
    return response.status >= 500 ? callbackFailed(request) : response
  } catch (error) {
    console.error('[auth] OAuth callback failed', error instanceof Error ? error.name : 'unknown error')
    return callbackFailed(request)
  }
}

export async function POST(request: Request) {
  const auth = getAuth()
  if (!auth) return unavailable()
  const handler = toNextJsHandler(auth)
  // Per-account throttle on password sign-in, independent of any client IP.
  const pathname = new URL(request.url).pathname
  if (pathname.endsWith('/sign-in/email')) return throttleEmailSignIn(request, handler.POST, getAuthPool())
  // Better Auth would append browser-supplied `scopes` to the Google request; sign-in is identity only.
  if (pathname.endsWith('/sign-in/social') || pathname.endsWith('/link-social')) {
    const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null
    if (!body || 'scopes' in body) return Response.json({ error: 'Unsupported sign-in request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  return handler.POST(request)
}
