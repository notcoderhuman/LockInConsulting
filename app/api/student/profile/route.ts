import { getAdminPool } from '@/lib/db/pool'
import { checkSameOrigin, json, jsonError, resolveStudentContext } from '@/lib/student/access'
import { normalizeFullName } from '@/lib/student/age-attestation'
import { createStudentProfile, discardUnfinishedAccount, PRIVACY_NOTICE_VERSION } from '@/lib/student/onboarding'

// The signed-in student's own profile. The user is always the session's own; nothing in the body
// can name another account.
//   POST { action: 'create', ageConfirmed: true, privacyAccepted: true }  finish a new sign-in
//   POST { action: 'discard' }                                           abandon an unfinished sign-in
//   POST { action: 'rename', displayName }                               change the name the team sees
//   POST { action: 'consent', privacyAccepted: true }                    accept an updated privacy notice
//   GET                                                                  name, email and sign-in methods
export async function GET(request: Request) {
  const ctx = await resolveStudentContext(request.headers)
  if (ctx.state !== 'ok') return jsonError(ctx.state === 'signed_out' ? 401 : 403, 'Sign in to continue.', { state: ctx.state })
  const [[user]] = (await getAdminPool().query('SELECT email FROM auth_user WHERE id = ?', [ctx.student.userId])) as unknown as [{ email: string }[]]
  const [methods] = (await getAdminPool().query('SELECT providerId FROM auth_account WHERE userId = ? ORDER BY createdAt', [ctx.student.userId])) as unknown as [{ providerId: string }[]]
  return json({ displayName: ctx.student.displayName, email: user?.email ?? null, methods: methods.map((m) => m.providerId) })
}

export async function POST(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  const ctx = await resolveStudentContext(request.headers)
  if (ctx.state === 'disabled' || ctx.state === 'error') return jsonError(503, 'Student accounts are not open yet.', { state: 'unavailable' })
  if (ctx.state === 'signed_out') return jsonError(401, 'Sign in to continue.', { state: 'signed_out' })
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Send JSON.')
  }
  if (body.action === 'rename') {
    if (ctx.state !== 'ok') return jsonError(403, 'Finish setting up your student account first.')
    const name = normalizeFullName(body.displayName)
    if (!name) return jsonError(400, 'Enter your full name, using letters only.')
    await getAdminPool().query("UPDATE student_profiles SET display_name = ? WHERE id = ? AND status = 'active'", [name, ctx.student.profileId])
    return json({ ok: true, displayName: name })
  }
  // Accepting the notice now published, after an earlier version (lib/student/access.ts needs_consent).
  if (body.action === 'consent') {
    if (ctx.state !== 'needs_consent') return jsonError(409, 'There is no new privacy notice to accept.')
    if (body.privacyAccepted !== true) return jsonError(400, 'Accept the privacy notice to continue, or delete your account.')
    await getAdminPool().query("UPDATE student_profiles SET privacy_notice_version = ? WHERE id = ? AND status = 'active'", [PRIVACY_NOTICE_VERSION, ctx.student.profileId])
    return json({ ok: true, version: PRIVACY_NOTICE_VERSION })
  }
  if (ctx.state !== 'needs_profile') return jsonError(409, 'This account already has its access settled.')
  const result = body.action === 'discard' ? await discardUnfinishedAccount(ctx.userId) : await createStudentProfile(ctx.userId, body, request.headers)
  return result.ok ? json({ ok: true }) : jsonError(result.status, result.error)
}
