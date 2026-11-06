import { getAuth } from '@/lib/auth'
import { AUTH_MODELS, PASSWORD_POLICY } from '@/lib/auth-options.mjs'
import { clearFailures, clock, reserveAttempt, takeToken } from '@/lib/auth-throttle'
import { getAdminPool, getAuthPool } from '@/lib/db/pool'
import { requireStudentApi } from '@/lib/student/access'
import { json, jsonError, readJson } from '@/lib/student/http'
import { PASSWORD_SET_LIMIT } from '@/lib/student/onboarding'

// POST { newPassword, currentPassword? }: the signed-in student sets a first password or changes it.
//   - Change: needs the current password; guesses share the bounded progressive delay of password
//     sign-in, keyed by account (lib/auth-throttle.ts), so a stolen session cannot guess it quickly.
//   - First password: only within AUTH_MODELS.session.freshAge of signing in, so an old or stolen
//     session cannot quietly add a password.
//   - Either way every other session is signed out; this browser stays signed in.
// Staff never reach this (requireStudentApi refuses them); their passwords change only via the CLI.
export async function POST(request: Request) {
  const student = await requireStudentApi(request, { mutation: true })
  if (student instanceof Response) return student
  const body = await readJson(request)
  if (body instanceof Response) return body
  const { minPasswordLength: min, maxPasswordLength: max } = PASSWORD_POLICY
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (newPassword.length < min || newPassword.length > max) return jsonError(400, `Use a password of ${min} to ${max} characters.`)
  const auth = getAuth()
  if (!auth) return jsonError(503, 'Sign-in is temporarily unavailable.')
  if (takeToken('password-set', PASSWORD_SET_LIMIT, clock.now()) > 0) return jsonError(429, 'Too many requests. Please try again in a moment.')

  const [rows] = await getAdminPool().query("SELECT password FROM auth_account WHERE userId = ? AND providerId = 'credential' LIMIT 1", [student.userId])
  const hasPassword = Boolean((rows as { password: string | null }[])[0]?.password)

  if (!hasPassword) {
    const session = await auth.api.getSession({ headers: request.headers })
    const age = Date.now() - new Date(session?.session.createdAt ?? 0).getTime()
    if (age > AUTH_MODELS.session.freshAge * 1000) return jsonError(403, 'For your security, sign in again (for example with an emailed code), then set your password.', { state: 'reauthenticate' })
    await auth.api.setPassword({ body: { newPassword }, headers: request.headers })
    await auth.api.revokeOtherSessions({ headers: request.headers })
    return json({ ok: true, changed: false })
  }

  if (typeof body.currentPassword !== 'string' || !body.currentPassword) return jsonError(400, 'Enter your current password.')
  const key = `change-password:${student.userId}`
  const wait = await reserveAttempt(getAuthPool(), key)
  if (wait > 0) return Response.json({ error: 'Too many attempts. Please try again later.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(Math.ceil(wait / 1000)) } })
  const res = await auth.api.changePassword({ body: { currentPassword: body.currentPassword, newPassword, revokeOtherSessions: true }, headers: request.headers, asResponse: true })
  if (!res.ok) return jsonError(res.status === 400 ? 400 : res.status, res.status === 400 ? 'Your current password isn’t right.' : 'Your password was not changed. Please try again.')
  await clearFailures(getAuthPool(), [key])
  // Better Auth issued a new session for this browser (the old ones are revoked): pass its cookie on.
  const out = json({ ok: true, changed: true })
  for (const cookie of res.headers.getSetCookie()) out.headers.append('Set-Cookie', cookie)
  return out
}
