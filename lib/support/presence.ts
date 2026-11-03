import type { Pool, PoolConnection } from 'mysql2/promise'
import { selectRows } from './db'

// Live team presence, server-backed (0006_staff_presence.sql).
//
//   heartbeat   the admin panel posts every 30 s while open (also in a background tab), only for an
//               authenticated team member who may reply to students; a write happens at most every 20 s
//   online      someone was seen within the lease (2 min): closed browser, crash or lost network all
//               end in "offline" once the lease runs out, and two tabs simply share one row
//   reconnecting the lease ran out less than a minute ago: a short sleep or network blip, not yet
//               treated as gone
//   offline     nobody for 3 min or more. Only then may Derek answer on the team's behalf.
//
// Students only ever read the state and a first name. They cannot write presence.

export const PRESENCE = { heartbeatMs: 30_000, writeEverySeconds: 20, leaseSeconds: 120, handoffAfterSeconds: 180 } as const

export type PresenceState = 'online' | 'reconnecting' | 'offline'

export interface TeamPresence {
  state: PresenceState
  /** First name of the one person online (or last seen); null when several are online or nobody ever was. */
  name: string | null
}

type Db = Pick<Pool, 'query'> | PoolConnection

/** Records that this team member is here. Callers must have checked support access. */
export async function touchPresence(db: Db, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO staff_presence (user_id, last_seen_at) VALUES (?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE last_seen_at = IF(last_seen_at < UTC_TIMESTAMP(3) - INTERVAL ${PRESENCE.writeEverySeconds} SECOND, UTC_TIMESTAMP(3), last_seen_at)`,
    [userId],
  )
}

const firstName = (name: unknown) => String(name ?? '').trim().split(/\s+/)[0] || null

export async function getTeamPresence(db: Db): Promise<TeamPresence> {
  // Only active members who may reply to students count; revoked staff never show as online.
  const rows = await selectRows(
    db,
    `SELECT u.name, TIMESTAMPDIFF(SECOND, p.last_seen_at, UTC_TIMESTAMP(3)) AS age
       FROM staff_presence p
       JOIN admin_members m ON m.user_id = p.user_id AND m.status = 'active' AND (m.role IN ('owner', 'reviewer') OR m.support_enabled = TRUE)
       JOIN auth_user u ON u.id = p.user_id
      ORDER BY p.last_seen_at DESC
      LIMIT 20`,
  )
  const online = rows.filter((r) => Number(r.age) < PRESENCE.leaseSeconds)
  if (online.length) return { state: 'online', name: online.length === 1 ? firstName(online[0].name) : null }
  const newest = rows[0]
  if (newest && Number(newest.age) < PRESENCE.handoffAfterSeconds) return { state: 'reconnecting', name: firstName(newest.name) }
  return { state: 'offline', name: newest ? firstName(newest.name) : null }
}
