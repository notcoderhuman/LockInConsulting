import { getAuth } from '@/lib/auth'
import { clientIpHeader, clock, takeToken } from '@/lib/auth-throttle'
import { newAccountsAllowed, signUpMethodAvailable } from '@/lib/identity/policy'
import { checkSameOrigin, jsonError } from '@/lib/student/access'
import { AGE_CONFIRM_LIMITS, ageCookieHeader, ageTokenFrom, issueAgeAttestation, normalizeFullName, revokeAgeAttestation } from '@/lib/student/age-attestation'

// POST { fullName, ageConfirmed: true } from /age-confirm: records the 18+ self-attestation and sets the
// short-lived HttpOnly token the Google sign-up callback needs (D-045). DELETE: cancel ("Back").
// Only while new student accounts can actually be created; never a substitute for that check.

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  // In tester mode this is open to anyone who reaches it, but only a listed email can then get a code or an
  // account (lib/auth-otp.ts, lib/auth.ts); the confirmation alone grants nothing.
  if (!getAuth() || !newAccountsAllowed() || !signUpMethodAvailable()) return jsonError(503, 'New student accounts aren’t open yet.', { state: 'unavailable' })
  // Request budget before anything is written (PRODUCTION-READINESS S-4): one process-wide bucket, and
  // per client IP only with a verified AUTH_CLIENT_IP_HEADER (unset on Hostinger, R-033).
  const now = clock.now()
  const ipHeader = clientIpHeader()
  const wait =
    (ipHeader ? takeToken(`age-ip:${(request.headers.get(ipHeader) ?? '').trim().slice(0, 64) || 'missing'}`, AGE_CONFIRM_LIMITS.perIp, now) : 0) ||
    takeToken('age-global', AGE_CONFIRM_LIMITS.global, now)
  if (wait > 0)
    return Response.json({ error: 'Too many requests. Please try again in a moment.' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(Math.max(1, Math.ceil(wait / 1000))) } })
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Send JSON.')
  }
  const fullName = normalizeFullName(body.fullName)
  if (!fullName) return jsonError(400, 'Enter your full name, using letters only.')
  if (body.ageConfirmed !== true) return jsonError(400, 'Confirm that you are 18 years of age or older to continue.')
  try {
    // A previous unused confirmation from this browser is replaced, never kept alongside.
    await revokeAgeAttestation(ageTokenFrom(request.headers.get('cookie')))
    const token = await issueAgeAttestation(fullName)
    return Response.json({ ok: true }, { headers: { ...NO_STORE, 'Set-Cookie': ageCookieHeader(token) } })
  } catch (error) {
    console.error('[age-confirm] could not record the confirmation', error instanceof Error ? error.message : 'unknown error')
    return jsonError(503, 'Something went wrong. Please try again.')
  }
}

export async function DELETE(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  try {
    await revokeAgeAttestation(ageTokenFrom(request.headers.get('cookie')))
  } catch (error) {
    console.error('[age-confirm] could not revoke the confirmation', error instanceof Error ? error.message : 'unknown error')
  }
  return Response.json({ ok: true }, { headers: { ...NO_STORE, 'Set-Cookie': ageCookieHeader(null) } })
}
