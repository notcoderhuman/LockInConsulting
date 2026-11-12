import type { Pool, PoolConnection } from 'mysql2/promise'
import type { AdminActor } from '@/lib/admin/roles'
import { assertActor, inTransaction, isDuplicate, selectRows, SupportError } from './db'
import { PRESENCE, touchPresence } from './presence'

// Who answers a student: the team member ("Dev") or Derek (0016_dev_availability.sql). Three separate facts,
// all scoped to one admin login session, decided here on the server and never by the browser:
//
//   1. availability   Dev switched themself Online for THIS login (staff_presence.available). Every new login
//                     starts Offline: a row written under another session id counts as Offline.
//   2. eligibility    Dev chose to appear online to this student, in this login (staff_student_visibility).
//   3. active chat    Dev has this student's conversation open now (conversation_presence, heartbeat lease).
//
// Only when all three hold, with fresh heartbeats and the login session still existing, does the student see
// Dev online and does Derek hold back for that conversation. In every other case Derek answers.

export const CHAT_PRESENCE = {
  /** The open conversation page re-claims this often (also in a background tab, which browsers slow to ~1/min). */
  heartbeatMs: 15_000,
  /** A claim older than this has lapsed: closed tab, crash, lost network. */
  leaseSeconds: 90,
} as const

type Db = Pick<Pool, 'query'> | PoolConnection

export interface ChatHandler {
  userId: string
  name: string | null
  /** When Dev entered this chat (UTC, 'YYYY-MM-DD HH:MM:SS.mmm'): the id of one "Dev has joined" event. */
  joinedAt: string
  conversationId: number
}

const firstName = (name: unknown) => String(name ?? '').trim().split(/\s+/)[0] || null

// The single definition of "Dev is handling this chat". Every gate is a JOIN, so a missing or stale piece
// (signed out, other login, switched Offline, student not enabled, lease lapsed, access revoked) means no row.
const HANDLER_SQL = `
  SELECT cp.user_id, cp.conversation_id, c.student_profile_id, u.name, DATE_FORMAT(cp.joined_at, '%Y-%m-%d %H:%i:%s.%f') AS joined_at
    FROM conversation_presence cp
    JOIN conversations c ON c.id = cp.conversation_id
    JOIN staff_presence sp ON sp.user_id = cp.user_id AND sp.available = 1 AND sp.availability_session_id = cp.session_id
    JOIN staff_student_visibility v ON v.user_id = cp.user_id AND v.student_profile_id = c.student_profile_id AND v.session_id = cp.session_id
    JOIN auth_session s ON s.id = cp.session_id AND s.userId = cp.user_id
    JOIN admin_members m ON m.user_id = cp.user_id AND m.status = 'active' AND (m.role IN ('owner', 'reviewer') OR m.support_enabled = TRUE)
    JOIN auth_user u ON u.id = cp.user_id
   WHERE cp.last_seen_at > UTC_TIMESTAMP(3) - INTERVAL ${CHAT_PRESENCE.leaseSeconds} SECOND
     AND sp.last_seen_at > UTC_TIMESTAMP(3) - INTERVAL ${PRESENCE.leaseSeconds} SECOND`

const toHandler = (r: Record<string, unknown>): ChatHandler => ({
  userId: String(r.user_id),
  name: firstName(r.name),
  joinedAt: String(r.joined_at).slice(0, 23),
  conversationId: Number(r.conversation_id),
})

/** The team member actively handling this conversation, or null: then Derek answers it. */
export async function conversationHandler(db: Db, conversationId: number): Promise<ChatHandler | null> {
  const [row] = await selectRows(db, `${HANDLER_SQL} AND cp.conversation_id = ? LIMIT 1`, [conversationId])
  return row ? toHandler(row) : null
}

/** What one student may know: whether a team member is in one of THEIR conversations now. Nothing about anyone else. */
export async function presenceForStudent(db: Db, studentProfileId: number): Promise<ChatHandler | null> {
  const [row] = await selectRows(db, `${HANDLER_SQL} AND c.student_profile_id = ? ORDER BY cp.joined_at DESC LIMIT 1`, [studentProfileId])
  return row ? toHandler(row) : null
}

// ---------------------------------------------------------------------------------------------
// Dev's own controls. Callers have authenticated the request; every function re-checks support access.
// ---------------------------------------------------------------------------------------------

function sessionOf(actor: AdminActor): string {
  if (!actor.sessionId) throw new SupportError(403, 'Sign in again.')
  return actor.sessionId
}

/**
 * Makes this login session the one the settings belong to. A row from an earlier login is reset: Offline,
 * every student Offline, no open chat. Caller holds a transaction.
 */
async function adoptSession(conn: PoolConnection, actor: AdminActor): Promise<void> {
  const session = sessionOf(actor)
  await touchPresence(conn, actor.userId)
  const [row] = await selectRows(conn, 'SELECT availability_session_id FROM staff_presence WHERE user_id = ? FOR UPDATE', [actor.userId])
  if (row && row.availability_session_id === session) return
  await conn.query('UPDATE staff_presence SET available = 0, availability_session_id = ? WHERE user_id = ?', [session, actor.userId])
  await conn.query('DELETE FROM staff_student_visibility WHERE user_id = ?', [actor.userId])
  await conn.query('DELETE FROM conversation_presence WHERE user_id = ? AND session_id <> ?', [actor.userId, session])
}

export interface StudentVisibility {
  studentProfileId: number
  name: string
  visible: boolean
  /** Their most recent conversation, for a link; null when they have not asked anything yet. */
  conversationId: number | null
  lastMessageAt: string | null
  /** Dev is in one of this student's chats right now and the student sees Dev online. */
  live: boolean
}

export interface MyAvailability {
  available: boolean
  students: StudentVisibility[]
}

/** Dev's settings for the current login. Read-only: a different login reads as Offline with every student Offline. */
export async function getMyAvailability(db: Db, actor: AdminActor): Promise<MyAvailability> {
  assertActor(actor, 'support.reply')
  const session = sessionOf(actor)
  const [me] = await selectRows(db, 'SELECT available, availability_session_id FROM staff_presence WHERE user_id = ?', [actor.userId])
  const current = me != null && me.availability_session_id === session
  const students = await selectRows(
    db,
    `SELECT s.id, s.display_name,
            (SELECT c.id FROM conversations c WHERE c.student_profile_id = s.id ORDER BY c.last_message_at DESC LIMIT 1) AS conversation_id,
            (SELECT MAX(c.last_message_at) FROM conversations c WHERE c.student_profile_id = s.id) AS last_message_at,
            EXISTS (SELECT 1 FROM staff_student_visibility v WHERE v.user_id = ? AND v.student_profile_id = s.id AND v.session_id = ?) AS visible
       FROM student_profiles s
      WHERE s.status = 'active'
      ORDER BY last_message_at IS NULL, last_message_at DESC, s.id DESC
      LIMIT 200`,
    [actor.userId, session],
  )
  const liveStudents = new Set((await selectRows(db, `${HANDLER_SQL} AND cp.user_id = ?`, [actor.userId])).map((r) => Number(r.student_profile_id)))
  return {
    available: current && Number(me.available) === 1,
    students: students.map((r) => ({
      studentProfileId: Number(r.id),
      name: String(r.display_name),
      visible: current && Number(r.visible) === 1,
      conversationId: r.conversation_id == null ? null : Number(r.conversation_id),
      lastMessageAt: r.last_message_at == null ? null : String(r.last_message_at),
      live: liveStudents.has(Number(r.id)),
    })),
  }
}

/** Global Online/Offline for this login. Offline takes effect at once for every student (the handler query needs available = 1). */
export async function setAvailable(pool: Pool, actor: AdminActor, available: boolean): Promise<void> {
  assertActor(actor, 'support.reply')
  await inTransaction(pool, async (conn) => {
    await adoptSession(conn, actor)
    await conn.query('UPDATE staff_presence SET available = ? WHERE user_id = ?', [available ? 1 : 0, actor.userId])
  })
}

/** Individual eligibility for one active student, in this login. */
export async function setStudentVisible(pool: Pool, actor: AdminActor, studentProfileId: number, visible: boolean): Promise<void> {
  assertActor(actor, 'support.reply')
  await inTransaction(pool, async (conn) => {
    const [student] = await selectRows(conn, "SELECT id FROM student_profiles WHERE id = ? AND status = 'active'", [studentProfileId])
    if (!student) throw new SupportError(404, 'Student not found.')
    await adoptSession(conn, actor)
    if (visible)
      await conn.query(
        'INSERT INTO staff_student_visibility (user_id, student_profile_id, session_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE session_id = VALUES(session_id)',
        [actor.userId, studentProfileId, sessionOf(actor)],
      )
    else await conn.query('DELETE FROM staff_student_visibility WHERE user_id = ? AND student_profile_id = ?', [actor.userId, studentProfileId])
  })
}

export type ChatClaim =
  | { state: 'mine'; handling: boolean; available: boolean; visible: boolean }
  | { state: 'other'; name: string | null }

/**
 * Dev has this conversation open (heartbeat from the conversation page). One holder per conversation: a fresh
 * claim by another team member is refused, so two people never both "handle" it; the same person's tabs share
 * one claim and keep its joined_at. `handling` says whether the student now sees Dev and Derek holds back.
 */
export async function claimConversation(pool: Pool, actor: AdminActor, conversationId: number): Promise<ChatClaim> {
  assertActor(actor, 'support.read')
  const session = sessionOf(actor)
  try {
    await inTransaction(pool, async (conn) => {
      const [conv] = await selectRows(conn, 'SELECT id FROM conversations WHERE id = ?', [conversationId])
      if (!conv) throw new SupportError(404, 'Conversation not found.')
      await adoptSession(conn, actor)
      const [held] = await selectRows(
        conn,
        `SELECT cp.user_id, cp.session_id, cp.last_seen_at > UTC_TIMESTAMP(3) - INTERVAL ${CHAT_PRESENCE.leaseSeconds} SECOND AS fresh, u.name
           FROM conversation_presence cp JOIN auth_user u ON u.id = cp.user_id WHERE cp.conversation_id = ? FOR UPDATE`,
        [conversationId],
      )
      if (held && Number(held.fresh) === 1 && held.user_id !== actor.userId) throw new ClaimedByOther(firstName(held.name))
      if (!held)
        await conn.query(
          'INSERT INTO conversation_presence (conversation_id, user_id, session_id, joined_at, last_seen_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))',
          [conversationId, actor.userId, session],
        )
      else if (Number(held.fresh) === 1 && held.session_id === session)
        await conn.query('UPDATE conversation_presence SET last_seen_at = UTC_TIMESTAMP(3) WHERE conversation_id = ?', [conversationId])
      else
        await conn.query(
          'UPDATE conversation_presence SET user_id = ?, session_id = ?, joined_at = UTC_TIMESTAMP(3), last_seen_at = UTC_TIMESTAMP(3) WHERE conversation_id = ?',
          [actor.userId, session, conversationId],
        )
    })
  } catch (error) {
    if (error instanceof ClaimedByOther) return { state: 'other', name: error.holder }
    // Two first claims at the same instant: the loser simply sees the winner on its next heartbeat.
    if (isDuplicate(error) || (error as { code?: string })?.code === 'ER_LOCK_DEADLOCK') return { state: 'other', name: null }
    throw error
  }
  const [state] = await selectRows(
    pool,
    `SELECT sp.available,
            EXISTS (SELECT 1 FROM staff_student_visibility v JOIN conversations c ON c.student_profile_id = v.student_profile_id
                     WHERE c.id = ? AND v.user_id = sp.user_id AND v.session_id = sp.availability_session_id) AS visible
       FROM staff_presence sp WHERE sp.user_id = ?`,
    [conversationId, actor.userId],
  )
  const handler = await conversationHandler(pool, conversationId)
  return { state: 'mine', handling: handler?.userId === actor.userId, available: Number(state?.available) === 1, visible: Number(state?.visible) === 1 }
}

/** Dev left the conversation page: the student sees Dev offline again at once, and Derek resumes. */
export async function releaseConversation(pool: Pool, actor: AdminActor, conversationId: number): Promise<void> {
  assertActor(actor, 'support.read')
  await pool.query('DELETE FROM conversation_presence WHERE conversation_id = ? AND user_id = ?', [conversationId, actor.userId])
}

class ClaimedByOther extends Error {
  constructor(readonly holder: string | null) {
    super('claimed')
  }
}
