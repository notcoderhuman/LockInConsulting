// Test helper: makes a team member actively handle one conversation, the way the admin UI does it
// (login session, Online, this student enabled, chat open: lib/support/availability.ts).
import type { Connection } from 'mysql2/promise'

export async function handleChat(db: Connection, userId: string, conversationId: number): Promise<string> {
  const sid = `sess-${userId}`.slice(0, 36)
  await db.query(
    'INSERT IGNORE INTO auth_session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, UTC_TIMESTAMP(3) + INTERVAL 1 DAY, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?)',
    [sid, `token-${sid}`, userId],
  )
  await db.query(
    `INSERT INTO staff_presence (user_id, last_seen_at, available, availability_session_id) VALUES (?, UTC_TIMESTAMP(3), 1, ?)
     ON DUPLICATE KEY UPDATE last_seen_at = UTC_TIMESTAMP(3), available = 1, availability_session_id = VALUES(availability_session_id)`,
    [userId, sid],
  )
  await db.query(
    `INSERT INTO staff_student_visibility (user_id, student_profile_id, session_id) SELECT ?, student_profile_id, ? FROM conversations WHERE id = ?
     ON DUPLICATE KEY UPDATE session_id = VALUES(session_id)`,
    [userId, sid, conversationId],
  )
  await db.query(
    `INSERT INTO conversation_presence (conversation_id, user_id, session_id, joined_at, last_seen_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), session_id = VALUES(session_id), last_seen_at = UTC_TIMESTAMP(3)`,
    [conversationId, userId, sid],
  )
  return sid
}

/** The team member's chat heartbeat stopped this long ago (closed tab, lost network). */
export const chatLastSeen = (db: Connection, secondsAgo: number) =>
  db.query('UPDATE conversation_presence SET last_seen_at = UTC_TIMESTAMP(3) - INTERVAL ? SECOND', [secondsAgo])
