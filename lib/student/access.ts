import 'server-only'
import type { RowDataPacket } from 'mysql2/promise'
import { headers } from 'next/headers'
import { getAuth } from '@/lib/auth'
import { getAdminPool } from '@/lib/db/pool'
import { REQUIRED_MIGRATIONS } from '@/lib/db/schema-version'
import { getStudentAreaStatus } from '@/lib/identity/policy'

// Server-side identity for the student chat. Every student route handler calls requireStudentApi,
// which derives the student from the session cookie. A student id, conversation owner or role
// sent by the browser is never trusted.

export interface StudentActor {
  userId: string
  profileId: number
  displayName: string
}

export type StudentContext =
  | { state: 'disabled' }
  | { state: 'error' }
  | { state: 'signed_out' }
  | { state: 'forbidden' }
  | { state: 'ok'; student: StudentActor }

export async function resolveStudentContext(requestHeaders: Headers): Promise<StudentContext> {
  const auth = getAuth()
  if (!getStudentAreaStatus(process.env, auth !== null).enabled || !auth) return { state: 'disabled' }
  try {
    const [applied] = await getAdminPool().query<RowDataPacket[]>('SELECT name FROM schema_migrations')
    const names = new Set(applied.map((r) => String(r.name)))
    if (!REQUIRED_MIGRATIONS.every((m) => names.has(m))) return { state: 'error' }
    const session = await auth.api.getSession({ headers: requestHeaders })
    if (!session?.user) return { state: 'signed_out' }
    const [rows] = await getAdminPool().query<RowDataPacket[]>(
      `SELECT s.id, s.display_name, (SELECT COUNT(*) FROM admin_members m WHERE m.user_id = s.user_id) AS memberships
         FROM student_profiles s WHERE s.user_id = ? AND s.status = 'active'`,
      [session.user.id],
    )
    const row = rows[0]
    // Staff accounts (even revoked ones) are never students.
    if (!row || Number(row.memberships) > 0) return { state: 'forbidden' }
    return { state: 'ok', student: { userId: session.user.id, profileId: Number(row.id), displayName: String(row.display_name) } }
  } catch (error) {
    console.error('[student] could not resolve session', error instanceof Error ? error.message : 'unknown error')
    return { state: 'error' }
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status, headers: NO_STORE })
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

/**
 * Cross-site request defence for cookie-authenticated JSON endpoints. Better Auth cookies are
 * SameSite=Lax; on top of that, a state-changing request must come from this site's own origin
 * and carry a JSON body (which a cross-site HTML form cannot send without a CORS preflight).
 */
export function checkSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin')
  const expected = new URL(request.url).origin
  const allowed = new Set([expected, ...(process.env.BETTER_AUTH_URL ? [new URL(process.env.BETTER_AUTH_URL).origin] : [])])
  if (!origin || !allowed.has(origin)) return jsonError(403, 'Cross-site requests are not allowed.')
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    return jsonError(415, 'Send JSON.')
  return null
}

/** Route handlers: the signed-in student, or the Response to return as-is. */
export async function requireStudentApi(request: Request, { mutation = false } = {}): Promise<StudentActor | Response> {
  if (mutation) {
    const crossSite = checkSameOrigin(request)
    if (crossSite) return crossSite
  }
  const ctx = await resolveStudentContext(request.headers)
  switch (ctx.state) {
    case 'disabled':
      return jsonError(503, 'Student accounts are not open yet.', { state: 'unavailable' })
    case 'error':
      return jsonError(503, 'Support is temporarily unavailable.', { state: 'unavailable' })
    case 'signed_out':
      return jsonError(401, 'Sign in to continue.', { state: 'signed_out' })
    case 'forbidden':
      return jsonError(403, 'This account cannot use the student area.', { state: 'forbidden' })
    case 'ok':
      return ctx.student
  }
}

/** Server components. */
export async function getStudentPageContext(): Promise<StudentContext> {
  return resolveStudentContext(await headers())
}
