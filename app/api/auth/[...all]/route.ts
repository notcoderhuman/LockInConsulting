import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

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
  return auth ? toNextJsHandler(auth).POST(request) : unavailable()
}
