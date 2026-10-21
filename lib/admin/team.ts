import type { Pool } from 'mysql2/promise'
import { assertActor, inTransaction, selectRows, SupportError } from '@/lib/support/db'
import { reasonText } from '@/lib/support/validation'
import { appendChangeLog } from './audit'
import { ADMIN_ROLES, type AdminActor, type AdminRole } from './roles'

// "Our Team": the owner-only view of admin members. From the browser an owner may only REDUCE
// access (revoke a member) or toggle the bounded support delegation for an editor. Creating
// accounts and granting or raising roles stays CLI-only (scripts/admin-user.mjs), so no browser
// session can ever escalate privileges.

export interface TeamMemberRow {
  userId: string
  name: string
  email: string
  role: AdminRole
  status: 'active' | 'revoked'
  supportEnabled: boolean
  grantedAt: string
  grantedBy: string
  revokedAt: string | null
  activeSessions: number
}

export async function listTeam(db: Pick<Pool, 'query'>, actor: AdminActor): Promise<TeamMemberRow[]> {
  assertActor(actor, 'members.read')
  const rows = await selectRows(
    db,
    `SELECT m.user_id, m.role, m.status, m.support_enabled, m.granted_at, m.granted_by, m.revoked_at, u.name, u.email,
            (SELECT COUNT(*) FROM auth_session s WHERE s.userId = m.user_id AND s.expiresAt > UTC_TIMESTAMP(3)) AS sessions
       FROM admin_members m JOIN auth_user u ON u.id = m.user_id
      ORDER BY m.status, FIELD(m.role, 'owner', 'reviewer', 'editor'), u.name`,
  )
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.name),
    email: String(r.email),
    role: (ADMIN_ROLES as readonly string[]).includes(String(r.role)) ? (r.role as AdminRole) : 'editor',
    status: r.status === 'active' ? 'active' : 'revoked',
    supportEnabled: Number(r.support_enabled) === 1,
    grantedAt: String(r.granted_at),
    grantedBy: String(r.granted_by),
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    activeSessions: Number(r.sessions),
  }))
}

export async function revokeMember(pool: Pool, actor: AdminActor, userId: string, rawReason: unknown): Promise<void> {
  assertActor(actor, 'members.manage')
  const parsed = reasonText.safeParse(rawReason ?? '')
  if (!parsed.success) throw new SupportError(400, 'Give a reason for revoking access.', { reason: parsed.error.issues.map((i) => i.message) })
  if (userId === actor.userId) throw new SupportError(409, 'You cannot revoke your own access. Ask another owner or use the CLI.')
  await inTransaction(pool, async (conn) => {
    // Lock every owner row so two owners cannot revoke each other at the same time.
    const owners = await selectRows(conn, "SELECT user_id FROM admin_members WHERE role = 'owner' AND status = 'active' FOR UPDATE")
    const [before] = await selectRows(conn, 'SELECT * FROM admin_members WHERE user_id = ? FOR UPDATE', [userId])
    if (!before) throw new SupportError(404, 'Member not found.')
    if (before.status === 'revoked') throw new SupportError(409, 'This member is already revoked.')
    if (before.role === 'owner' && owners.length <= 1) throw new SupportError(409, 'The last active owner cannot be revoked.')
    await conn.query("UPDATE admin_members SET status = 'revoked', revoked_at = UTC_TIMESTAMP(3), support_enabled = FALSE WHERE user_id = ?", [userId])
    // End every session immediately, as the CLI does.
    await conn.query('DELETE FROM auth_session WHERE userId = ?', [userId])
    const [after] = await selectRows(conn, 'SELECT * FROM admin_members WHERE user_id = ?', [userId])
    // admin_members is keyed by a string user id; like the CLI, the log uses entity id 0 and
    // carries the user id in the snapshot.
    await appendChangeLog(conn, {
      entityType: 'admin_member',
      entityId: 0,
      action: 'role_revoke',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: parsed.data,
      before: { userId, role: String(before.role), status: String(before.status) },
      after: { userId, role: String(after.role), status: String(after.status) },
    })
  })
}

export async function setSupportAccess(pool: Pool, actor: AdminActor, userId: string, enabled: boolean): Promise<void> {
  assertActor(actor, 'members.manage')
  await inTransaction(pool, async (conn) => {
    const [member] = await selectRows(conn, 'SELECT * FROM admin_members WHERE user_id = ? FOR UPDATE', [userId])
    if (!member) throw new SupportError(404, 'Member not found.')
    if (member.status !== 'active') throw new SupportError(409, 'Only active members can be given support access.')
    if (member.role !== 'editor') throw new SupportError(409, 'Reviewers and owners already have support access through their role.')
    if ((Number(member.support_enabled) === 1) === enabled) return
    await conn.query('UPDATE admin_members SET support_enabled = ? WHERE user_id = ?', [enabled, userId])
    await appendChangeLog(conn, {
      entityType: 'admin_member',
      entityId: 0,
      action: enabled ? 'support_grant' : 'support_revoke',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: null,
      before: { userId, supportEnabled: !enabled },
      after: { userId, supportEnabled: enabled },
    })
  })
}
