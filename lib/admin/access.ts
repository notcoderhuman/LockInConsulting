import 'server-only'
import type { RowDataPacket } from 'mysql2/promise'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { getAdminPool } from '@/lib/db/pool'
import { REQUIRED_MIGRATIONS } from '@/lib/db/schema-version'
import { ADMIN_ROLES, actorCan, type AdminActor, type AdminRole, type Permission } from './roles'

// Server-side authorisation for every admin page, API route and server action. Hiding a link in
// the UI is never relied on: each entry point calls one of the require* functions below.

export type AdminContext =
  | { state: 'not_configured' }
  | { state: 'error' }
  | { state: 'signed_out' }
  | { state: 'forbidden'; email: string }
  | { state: 'ok'; actor: AdminActor }

async function schemaIsCurrent(): Promise<boolean> {
  const [rows] = await getAdminPool().query<RowDataPacket[]>('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((r) => String(r.name)))
  return REQUIRED_MIGRATIONS.every((m) => applied.has(m))
}

export async function resolveAdminContext(requestHeaders: Headers): Promise<AdminContext> {
  const auth = getAuth()
  if (!auth) return { state: 'not_configured' }
  try {
    if (!(await schemaIsCurrent())) {
      console.error('[admin] database schema is missing required migrations; refusing admin access')
      return { state: 'error' }
    }
    const session = await auth.api.getSession({ headers: requestHeaders })
    if (!session?.user) return { state: 'signed_out' }
    // An account is either staff or a student, never both: a user who also has a student
    // profile is refused admin access (see lib/identity/policy.ts).
    const [rows] = await getAdminPool().query<RowDataPacket[]>(
      `SELECT m.role, m.support_enabled, (SELECT COUNT(*) FROM student_profiles s WHERE s.user_id = m.user_id) AS student_profiles
         FROM admin_members m WHERE m.user_id = ? AND m.status = 'active'`,
      [session.user.id],
    )
    const role = rows[0]?.role as AdminRole | undefined
    if (!role || !ADMIN_ROLES.includes(role) || Number(rows[0].student_profiles) > 0)
      return { state: 'forbidden', email: session.user.email }
    return {
      state: 'ok',
      actor: { userId: session.user.id, name: session.user.name, email: session.user.email, role, supportEnabled: Boolean(Number(rows[0].support_enabled)) },
    }
  } catch (error) {
    console.error('[admin] could not resolve session', error)
    return { state: 'error' }
  }
}

/** For pages: redirects instead of rendering anything an unauthorised visitor shouldn't see. */
export async function requireAdminPage(permission: Permission = 'data.read'): Promise<AdminActor> {
  const ctx = await resolveAdminContext(await headers())
  if (ctx.state === 'not_configured' || ctx.state === 'error') redirect('/admin/unavailable')
  if (ctx.state === 'signed_out') redirect('/admin/sign-in')
  if (ctx.state === 'forbidden' || !actorCan(ctx.actor, permission)) redirect('/admin/forbidden')
  return ctx.actor
}

export class AccessDeniedError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

function denial(ctx: AdminContext, permission: Permission): AccessDeniedError | null {
  switch (ctx.state) {
    case 'not_configured':
    case 'error':
      return new AccessDeniedError(503, 'The admin area is unavailable.')
    case 'signed_out':
      return new AccessDeniedError(401, 'Sign in to continue.')
    case 'forbidden':
      return new AccessDeniedError(403, 'You do not have admin access.')
    case 'ok':
      return actorCan(ctx.actor, permission) ? null : new AccessDeniedError(403, 'You do not have permission to do this.')
  }
}

/** For server actions: throws AccessDeniedError. */
export async function requireAdminAction(permission: Permission): Promise<AdminActor> {
  const ctx = await resolveAdminContext(await headers())
  const denied = denial(ctx, permission)
  if (denied) throw denied
  return (ctx as Extract<AdminContext, { state: 'ok' }>).actor
}

/** For route handlers: returns the actor, or a JSON error Response to return as-is. */
export async function requireAdminApi(request: Request, permission: Permission): Promise<AdminActor | Response> {
  const ctx = await resolveAdminContext(request.headers)
  const denied = denial(ctx, permission)
  if (denied)
    return Response.json({ error: denied.message }, { status: denied.status, headers: { 'Cache-Control': 'no-store' } })
  return (ctx as Extract<AdminContext, { state: 'ok' }>).actor
}
