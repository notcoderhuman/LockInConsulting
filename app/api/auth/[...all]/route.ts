import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'
import { throttleEmailSignIn } from '@/lib/auth-throttle'
import { getAuthPool } from '@/lib/db/pool'

// Fails closed: without a valid secret, database and base URL, Better Auth is never constructed
// (so it can't fall back to a default secret) and every auth endpoint returns 503.

function unavailable() {
  return Response.json({ error: 'Authentication is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  const auth = getAuth()
  return auth ? toNextJsHandler(auth).GET(request) : unavailable()
}

export async function POST(request: Request) {
  const auth = getAuth()
  if (!auth) return unavailable()
  const handler = toNextJsHandler(auth)
  // Per-account throttle on password sign-in, independent of any client IP.
  if (new URL(request.url).pathname.endsWith('/sign-in/email')) return throttleEmailSignIn(request, handler.POST, getAuthPool())
  return handler.POST(request)
}
