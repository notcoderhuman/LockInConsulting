import { getAuth } from '@/lib/auth'
import { signUpMethodAvailable, studentSignUpOpen } from '@/lib/identity/policy'
import { checkSameOrigin, jsonError } from '@/lib/student/access'
import { ageCookieHeader, ageTokenFrom, issueAgeAttestation, normalizeFullName, revokeAgeAttestation } from '@/lib/student/age-attestation'

// POST { fullName, ageConfirmed: true } from /age-confirm: records the 18+ self-attestation and sets the
// short-lived HttpOnly token the Google sign-up callback needs (D-045). DELETE: cancel ("Back").
// Only while new student accounts can actually be created; never a substitute for that check.

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  if (!getAuth() || !studentSignUpOpen() || !signUpMethodAvailable()) return jsonError(503, 'New student accounts aren’t open yet.', { state: 'unavailable' })
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
