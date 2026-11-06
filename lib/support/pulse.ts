import type { Pool, RowDataPacket } from 'mysql2/promise'

type Db = Pick<Pool, 'query'>

/**
 * A short string that changes whenever the Live Inbox would look different: a new message, a status change or
 * takeover or read mark (the conversation row's updated_at), or a Derek draft appearing, changing or being
 * decided. Scoped to one conversation, or across all of them. One cheap query; no text leaves the database.
 */
export async function inboxPulse(db: Db, conversationId: number | null): Promise<string> {
  const scoped = conversationId != null
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       (SELECT COALESCE(MAX(id), 0) FROM messages ${scoped ? 'WHERE conversation_id = ?' : ''}) AS m,
       (SELECT COALESCE(CAST(UNIX_TIMESTAMP(MAX(updated_at)) * 1000 AS UNSIGNED), 0) FROM conversations ${scoped ? 'WHERE id = ?' : ''}) AS c,
       (SELECT COALESCE(MAX(id), 0) FROM ai_drafts ${scoped ? 'WHERE conversation_id = ?' : ''}) AS d,
       (SELECT COALESCE(SUM(current_revision), 0) + COUNT(*) + COALESCE(SUM(status = 'ready'), 0) * 1000 FROM ai_drafts WHERE status IN ('generating', 'ready') ${scoped ? 'AND conversation_id = ?' : ''}) AS o`,
    scoped ? [conversationId, conversationId, conversationId, conversationId] : [],
  )
  const r = rows[0]
  return `${r.m}.${r.c}.${r.d}.${r.o}`
}
