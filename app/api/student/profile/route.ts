import { checkSameOrigin, json, jsonError, resolveStudentContext } from '@/lib/student/access'
import { createStudentProfile, discardUnfinishedAccount } from '@/lib/student/onboarding'

// Completes (or abandons) a Google sign-in: { action: 'create', ageConfirmed: true, privacyAccepted: true }
// creates the student profile; { action: 'discard' } deletes the unfinished account. The user is
// always the session's own; nothing in the body can name another account.
export async function POST(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  const ctx = await resolveStudentContext(request.headers)
  if (ctx.state === 'disabled' || ctx.state === 'error') return jsonError(503, 'Student accounts are not open yet.', { state: 'unavailable' })
  if (ctx.state === 'signed_out') return jsonError(401, 'Sign in to continue.', { state: 'signed_out' })
  if (ctx.state !== 'needs_profile') return jsonError(409, 'This account already has its access settled.')
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Send JSON.')
  }
  const result = body.action === 'discard' ? await discardUnfinishedAccount(ctx.userId) : await createStudentProfile(ctx.userId, body)
  return result.ok ? json({ ok: true }) : jsonError(result.status, result.error)
}
