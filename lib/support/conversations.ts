import type { Pool, PoolConnection } from 'mysql2/promise'
import { appendChangeLog } from '@/lib/admin/audit'
import { actorCan, type AdminActor } from '@/lib/admin/roles'
import type { StudentActor } from '@/lib/student/access'
import { attributionLabel, type AuthorKind } from './attribution'
import { assertActor, inTransaction, isDuplicate, selectRows, sha256, SupportError, type Row } from './db'
import { createNotification, markConversationNotificationsRead, staffViewer } from './notifications'
import { isConversationStatus, nextStatus, STUDENT_ACKNOWLEDGEMENT, STUDENT_STATUS_LABEL, TransitionError, type ConversationEvent, type ConversationStatus } from './state'
import { deriveSubject, newConversationInput, newMessageInput, reasonText } from './validation'

// Conversations and messages. Ownership and permissions are checked here, on the server, for
// every read and write: a student only ever reaches rows where conversations.student_profile_id
// is their own profile (taken from the session, never from the request), and staff need the
// relevant support permission. Every write is one transaction that locks the conversation row
// FOR UPDATE, so a human reply and Derek's worker can never both answer the same question.

type Db = Pick<Pool, 'query'> | PoolConnection

export const LIMITS = {
  studentMessagesPer10Min: 20,
  conversationsPerDay: 10,
  openConversations: 20,
}

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
  const out: Record<string, string[]> = {}
  for (const i of issues) (out[String(i.path[0] ?? 'form')] ??= []).push(i.message)
  return out
}

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success) throw new SupportError(400, 'Check the highlighted fields.', fieldErrors(r.error.issues))
  return r.data
}

/** Applies a state-machine event inside the caller's transaction and records it. */
export async function applyEvent(
  conn: PoolConnection,
  conversation: { id: number; status: ConversationStatus },
  event: ConversationEvent,
  actor: { kind: 'student' | 'staff' | 'derek' | 'system'; id: string | null },
  reason: string | null = null,
): Promise<ConversationStatus> {
  const to = nextStatus(conversation.status, event)
  if (to !== conversation.status) {
    await conn.query('UPDATE conversations SET status = ? WHERE id = ?', [to, conversation.id])
    await conn.query(
      'INSERT INTO conversation_events (conversation_id, from_status, to_status, actor_kind, actor_id, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [conversation.id, conversation.status, to, actor.kind, actor.id, reason],
    )
  }
  return to
}

export async function lockConversation(conn: PoolConnection, id: number, studentProfileId?: number): Promise<Row & { status: ConversationStatus }> {
  const rows = await selectRows(
    conn,
    `SELECT c.*, s.status AS student_status, s.user_id AS student_user_id, s.age_confirmed_at AS student_age_confirmed_at
       FROM conversations c JOIN student_profiles s ON s.id = c.student_profile_id
      WHERE c.id = ? ${studentProfileId != null ? 'AND c.student_profile_id = ?' : ''} FOR UPDATE`,
    studentProfileId != null ? [id, studentProfileId] : [id],
  )
  // "Not yours" and "does not exist" are indistinguishable to the caller.
  if (!rows[0]) throw new SupportError(404, 'Conversation not found.')
  return rows[0] as Row & { status: ConversationStatus }
}

async function checkStudentRate(conn: PoolConnection, student: StudentActor) {
  const [[recent]] = await conn.query<Row[]>(
    "SELECT COUNT(*) AS n FROM messages WHERE author_kind = 'student' AND author_user_id = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE",
    [student.userId],
  )
  if (Number(recent.n) >= LIMITS.studentMessagesPer10Min)
    throw new SupportError(429, 'You have sent a lot of messages in a short time. Please wait a few minutes and try again.')
}

// ---------------------------------------------------------------------------------------------
// Student side
// ---------------------------------------------------------------------------------------------

export interface SendResult {
  conversationId: number
  messageId: number
  duplicate: boolean
  /** Set when a new student message was stored and Derek may be asked for a draft. */
  triggerMessageId: number | null
}

export async function createConversation(pool: Pool, student: StudentActor, input: unknown): Promise<SendResult> {
  const data = parse(newConversationInput, input)
  return inTransaction(pool, async (conn) => {
    // Serialise this student's creations so the daily limit cannot be raced.
    await conn.query('SELECT id FROM student_profiles WHERE id = ? AND status = ? FOR UPDATE', [student.profileId, 'active'])
    const existing = await selectRows(
      conn,
      "SELECT c.id, (SELECT MIN(m.id) FROM messages m WHERE m.conversation_id = c.id AND m.author_kind = 'student') AS first_message_id FROM conversations c WHERE c.student_profile_id = ? AND c.client_request_id = ?",
      [student.profileId, data.clientRequestId],
    )
    if (existing[0]) return { conversationId: Number(existing[0].id), messageId: Number(existing[0].first_message_id), duplicate: true, triggerMessageId: null }

    const [[counts]] = await conn.query<Row[]>(
      `SELECT SUM(created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY) AS today, SUM(status <> 'resolved') AS unresolved
         FROM conversations WHERE student_profile_id = ?`,
      [student.profileId],
    )
    if (Number(counts.today ?? 0) >= LIMITS.conversationsPerDay)
      throw new SupportError(429, 'You have started the maximum number of conversations for today. Please continue an existing one.')
    if (Number(counts.unresolved ?? 0) >= LIMITS.openConversations)
      throw new SupportError(429, 'You have many open conversations. Please continue an existing one.')
    await checkStudentRate(conn, student)

    const [conv] = await conn.query(
      'INSERT INTO conversations (student_profile_id, subject, status, client_request_id) VALUES (?, ?, ?, ?)',
      [student.profileId, deriveSubject(data.subject || undefined, data.body), 'open', data.clientRequestId],
    )
    const conversationId = Number((conv as { insertId: number }).insertId)
    const [msg] = await conn.query(
      "INSERT INTO messages (conversation_id, author_kind, author_user_id, body, client_request_id) VALUES (?, 'student', ?, ?, ?)",
      [conversationId, student.userId, data.body, data.clientRequestId],
    )
    const messageId = Number((msg as { insertId: number }).insertId)
    await conn.query(
      'UPDATE conversations SET last_student_message_id = ?, student_last_read_id = ?, last_message_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [messageId, messageId, conversationId],
    )
    await conn.query(
      "INSERT INTO conversation_events (conversation_id, from_status, to_status, actor_kind, actor_id) VALUES (?, NULL, 'open', 'student', ?)",
      [conversationId, student.userId],
    )
    await createNotification(conn, {
      audience: 'staff_support',
      kind: 'new_question',
      conversationId,
      title: `New question in conversation #${conversationId}`,
      targetPath: `/admin/inbox/${conversationId}`,
    })
    return { conversationId, messageId, duplicate: false, triggerMessageId: messageId }
  })
}

export async function sendStudentMessage(pool: Pool, student: StudentActor, conversationId: number, input: unknown): Promise<SendResult> {
  const data = parse(newMessageInput, input)
  return inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId, student.profileId)
    const dup = await selectRows(
      conn,
      "SELECT id FROM messages WHERE conversation_id = ? AND author_kind = 'student' AND client_request_id = ?",
      [conversationId, data.clientRequestId],
    )
    if (dup[0]) return { conversationId, messageId: Number(dup[0].id), duplicate: true, triggerMessageId: null }
    await checkStudentRate(conn, student)
    let messageId: number
    try {
      const [msg] = await conn.query(
        "INSERT INTO messages (conversation_id, author_kind, author_user_id, body, client_request_id) VALUES (?, 'student', ?, ?, ?)",
        [conversationId, student.userId, data.body, data.clientRequestId],
      )
      messageId = Number((msg as { insertId: number }).insertId)
    } catch (e) {
      if (isDuplicate(e)) throw new SupportError(409, 'This message was already sent.')
      throw e
    }
    await conn.query(
      'UPDATE conversations SET last_student_message_id = ?, student_last_read_id = GREATEST(student_last_read_id, ?), last_message_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [messageId, messageId, conversationId],
    )
    // Pending drafts answered an earlier message; they must not be approved for this conversation now.
    await conn.query("UPDATE ai_drafts SET status = 'superseded' WHERE conversation_id = ? AND status IN ('generating', 'ready')", [conversationId])
    await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'student_message' }, { kind: 'student', id: student.userId })
    await createNotification(conn, {
      audience: 'staff_support',
      kind: 'student_reply',
      conversationId,
      title: `New message in conversation #${conversationId}`,
      targetPath: `/admin/inbox/${conversationId}`,
    })
    return { conversationId, messageId, duplicate: false, triggerMessageId: messageId }
  })
}

export interface StudentConversationSummary {
  id: number
  subject: string
  /** Friendly label only: internal review and failure states are never sent to students. */
  statusLabel: string
  lastMessageAt: string
  unread: number
}

export async function listStudentConversations(db: Db, student: StudentActor): Promise<StudentConversationSummary[]> {
  const rows = await selectRows(
    db,
    `SELECT c.id, c.subject, c.status, c.last_message_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.author_kind <> 'student' AND m.id > c.student_last_read_id) AS unread
       FROM conversations c WHERE c.student_profile_id = ? ORDER BY c.last_message_at DESC, c.id DESC LIMIT 100`,
    [student.profileId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    subject: String(r.subject),
    statusLabel: isConversationStatus(r.status) ? STUDENT_STATUS_LABEL[r.status] : 'Waiting for the LockIn team',
    lastMessageAt: String(r.last_message_at),
    unread: Number(r.unread),
  }))
}

export interface MessageView {
  id: number
  authorKind: AuthorKind
  label: string
  body: string
  createdAt: string
  mine: boolean
}

export interface MessagePage {
  messages: MessageView[]
  hasMore: boolean
}

async function readMessages(db: Db, conversationId: number, before: number | null, limit: number): Promise<{ rows: Row[]; hasMore: boolean }> {
  const rows = await selectRows(
    db,
    `SELECT m.id, m.author_kind, m.author_user_id, m.reviewed_by, m.body, m.created_at,
            au.name AS author_name, rv.name AS reviewer_name, sp.display_name AS student_name,
            (r.created_by_kind = 'staff') AS edited_by_human
       FROM messages m
       LEFT JOIN auth_user au ON au.id = m.author_user_id AND m.author_kind = 'staff'
       LEFT JOIN auth_user rv ON rv.id = m.reviewed_by
       LEFT JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN student_profiles sp ON sp.id = c.student_profile_id
       LEFT JOIN ai_drafts d ON d.id = m.draft_id
       LEFT JOIN ai_draft_revisions r ON r.draft_id = d.id AND r.revision = d.current_revision
      WHERE m.conversation_id = ? ${before ? 'AND m.id < ?' : ''}
      ORDER BY m.id DESC LIMIT ?`,
    [conversationId, ...(before ? [before] : []), limit + 1],
  )
  return { rows: rows.slice(0, limit).reverse(), hasMore: rows.length > limit }
}

function toView(r: Row, viewer: 'student' | 'staff', viewerUserId: string): MessageView {
  const authorKind = r.author_kind as AuthorKind
  return {
    id: Number(r.id),
    authorKind,
    label: attributionLabel(
      {
        authorKind,
        authorName: authorKind === 'student' ? (r.student_name == null ? null : String(r.student_name)) : r.author_name == null ? null : String(r.author_name),
        reviewedByName: r.reviewer_name == null ? (r.reviewed_by == null ? null : 'a LockIn team member') : String(r.reviewer_name),
        editedByHuman: Number(r.edited_by_human) === 1,
      },
      viewer,
    ),
    body: String(r.body),
    createdAt: String(r.created_at),
    mine: r.author_user_id != null && String(r.author_user_id) === viewerUserId,
  }
}

export async function getStudentMessages(db: Db, student: StudentActor, conversationId: number, { before = null, limit = 30 }: { before?: number | null; limit?: number } = {}) {
  const conv = await selectRows(
    db,
    `SELECT c.id, c.subject, c.status, c.last_student_message_id,
            (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id = c.id AND m.author_kind <> 'student') AS last_reply_id
       FROM conversations c WHERE c.id = ? AND c.student_profile_id = ?`,
    [conversationId, student.profileId],
  )
  if (!conv[0]) throw new SupportError(404, 'Conversation not found.')
  const { rows, hasMore } = await readMessages(db, conversationId, before, limit)
  const status = String(conv[0].status)
  // The student's latest message has no reply yet (held for review, escalated, failed, or simply
  // waiting): say plainly that a person will follow up. Never why, and never any internal state.
  const waiting = status !== 'resolved' && Number(conv[0].last_student_message_id) > Number(conv[0].last_reply_id ?? 0)
  return {
    conversation: {
      id: conversationId,
      subject: String(conv[0].subject),
      statusLabel: isConversationStatus(status) ? STUDENT_STATUS_LABEL[status] : 'Waiting for the LockIn team',
      acknowledgement: waiting ? STUDENT_ACKNOWLEDGEMENT : null,
    },
    messages: rows.map((r) => toView(r, 'student', student.userId)),
    hasMore,
  }
}

export async function markStudentRead(db: Db, student: StudentActor, conversationId: number): Promise<void> {
  const [res] = await db.query(
    `UPDATE conversations c
        SET c.student_last_read_id = GREATEST(c.student_last_read_id, (SELECT COALESCE(MAX(m.id), 0) FROM messages m WHERE m.conversation_id = c.id))
      WHERE c.id = ? AND c.student_profile_id = ?`,
    [conversationId, student.profileId],
  )
  if (!(res as { affectedRows: number }).affectedRows) throw new SupportError(404, 'Conversation not found.')
  await db.query(
    "INSERT IGNORE INTO notification_reads (notification_id, user_id) SELECT n.id, ? FROM notifications n WHERE n.audience = 'user' AND n.recipient_user_id = ? AND n.conversation_id = ?",
    [student.userId, student.userId, conversationId],
  )
}

// ---------------------------------------------------------------------------------------------
// Staff side (Live Inbox)
// ---------------------------------------------------------------------------------------------

export const INBOX_PAGE_SIZE = 25

/** Cross-status views of the queue. */
export const INBOX_VIEWS = ['held', 'escalated', 'taken_over'] as const
export type InboxView = (typeof INBOX_VIEWS)[number]

// held       Auto Mode wrote a reply but held it for a person
// escalated  Derek failed, or its open draft is high-risk (visa, legal, distress, invented facts…)
// taken_over a team member is handling it and Derek is paused
const VIEW_SQL: Record<InboxView, string> = {
  held: "EXISTS (SELECT 1 FROM ai_drafts d WHERE d.conversation_id = c.id AND d.status = 'ready' AND d.hold_reason IS NOT NULL)",
  escalated: "(c.status = 'failed' OR EXISTS (SELECT 1 FROM ai_drafts d WHERE d.conversation_id = c.id AND d.status = 'ready' AND d.risk_level = 'high'))",
  taken_over: 'c.ai_paused_by IS NOT NULL',
}

export interface InboxFilters {
  status?: ConversationStatus | null
  view?: InboxView | null
  unread?: boolean
  page?: number
}

export async function listInbox(db: Db, actor: AdminActor, filters: InboxFilters = {}) {
  assertActor(actor, 'support.read')
  const where: string[] = []
  const params: unknown[] = []
  if (filters.status) where.push('c.status = ?'), params.push(filters.status)
  if (filters.view) where.push(VIEW_SQL[filters.view])
  if (filters.unread) where.push('c.last_student_message_id > c.staff_last_read_id')
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const page = Math.max(1, filters.page ?? 1)
  const [rows, [count]] = await Promise.all([
    selectRows(
      db,
      `SELECT c.id, c.subject, c.status, c.last_message_at, sp.display_name, sp.status AS student_status,
              (c.last_student_message_id > c.staff_last_read_id) AS unread, (c.ai_paused_by IS NOT NULL) AS taken_over,
              (SELECT COUNT(*) FROM ai_drafts d WHERE d.conversation_id = c.id AND d.status = 'ready') AS pending_drafts
         FROM conversations c JOIN student_profiles sp ON sp.id = c.student_profile_id
         ${clause} ORDER BY c.last_message_at DESC, c.id DESC LIMIT ? OFFSET ?`,
      [...params, INBOX_PAGE_SIZE, (page - 1) * INBOX_PAGE_SIZE],
    ),
    selectRows(db, `SELECT COUNT(*) AS n FROM conversations c ${clause}`, params),
  ])
  return {
    total: Number(count.n),
    page,
    rows: rows.map((r) => ({
      id: Number(r.id),
      subject: String(r.subject),
      status: r.status as ConversationStatus,
      lastMessageAt: String(r.last_message_at),
      studentName: String(r.display_name),
      unread: Number(r.unread) === 1,
      takenOver: Number(r.taken_over) === 1,
      pendingDrafts: Number(r.pending_drafts),
    })),
  }
}

export async function getInboxCounts(db: Db, actor: AdminActor) {
  assertActor(actor, 'support.read')
  const rows = await selectRows(
    db,
    'SELECT status, COUNT(*) AS n, SUM(last_student_message_id > staff_last_read_id) AS unread FROM conversations GROUP BY status',
  )
  const byStatus: Record<ConversationStatus, number> = { open: 0, awaiting_human_review: 0, awaiting_student_reply: 0, resolved: 0, failed: 0 }
  let unread = 0
  for (const r of rows) {
    if (isConversationStatus(r.status)) byStatus[r.status] = Number(r.n)
    unread += Number(r.unread ?? 0)
  }
  const [[drafts]] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM ai_drafts WHERE status = 'ready'")
  const [[views]] = await db.query<Row[]>(
    `SELECT ${INBOX_VIEWS.map((v) => `COALESCE(SUM(${VIEW_SQL[v]}), 0) AS ${v}`).join(', ')} FROM conversations c`,
  )
  const byView = Object.fromEntries(INBOX_VIEWS.map((v) => [v, Number(views[v])])) as Record<InboxView, number>
  return { byStatus, byView, unread, pendingDrafts: Number(drafts.n) }
}

export async function getConversationForStaff(db: Db, actor: AdminActor, conversationId: number, { before = null, limit = 40 }: { before?: number | null; limit?: number } = {}) {
  assertActor(actor, 'support.read')
  const conv = await selectRows(
    db,
    `SELECT c.*, sp.display_name, sp.status AS student_status, sp.id AS profile_id, pu.name AS ai_paused_by_name
       FROM conversations c JOIN student_profiles sp ON sp.id = c.student_profile_id
       LEFT JOIN auth_user pu ON pu.id = c.ai_paused_by WHERE c.id = ?`,
    [conversationId],
  )
  if (!conv[0]) throw new SupportError(404, 'Conversation not found.')
  const { rows, hasMore } = await readMessages(db, conversationId, before, limit)
  const events = await selectRows(
    db,
    `SELECT e.*, u.name AS actor_name FROM conversation_events e LEFT JOIN auth_user u ON u.id = e.actor_id
      WHERE e.conversation_id = ? ORDER BY e.id DESC LIMIT 20`,
    [conversationId],
  )
  const c = conv[0]
  return {
    conversation: {
      id: Number(c.id),
      subject: String(c.subject),
      status: c.status as ConversationStatus,
      studentName: String(c.display_name),
      studentProfileId: Number(c.profile_id),
      studentActive: c.student_status === 'active',
      createdAt: String(c.created_at),
      lastStudentMessageId: Number(c.last_student_message_id),
      /** Set while a team member has taken the conversation over from Derek. */
      takenOver: c.ai_paused_by == null ? null : { byName: c.ai_paused_by_name == null ? 'a team member' : String(c.ai_paused_by_name), at: String(c.ai_paused_at) },
    },
    messages: rows.map((r) => toView(r, 'staff', actor.userId)),
    hasMore,
    events: events.map((e) => ({
      id: Number(e.id),
      from: e.from_status == null ? null : String(e.from_status),
      to: String(e.to_status),
      actorKind: String(e.actor_kind),
      actorName: e.actor_name == null ? null : String(e.actor_name),
      reason: e.reason == null ? null : String(e.reason),
      createdAt: String(e.created_at),
    })),
  }
}

export async function markStaffRead(pool: Pool, actor: AdminActor, conversationId: number): Promise<void> {
  assertActor(actor, 'support.read')
  await pool.query('UPDATE conversations SET staff_last_read_id = GREATEST(staff_last_read_id, last_student_message_id) WHERE id = ?', [conversationId])
  await markConversationNotificationsRead(pool, staffViewer(actor), conversationId)
}

export async function staffReply(pool: Pool, actor: AdminActor, conversationId: number, input: unknown): Promise<{ messageId: number; duplicate: boolean }> {
  assertActor(actor, 'support.reply')
  const data = parse(newMessageInput, input)
  return inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    if (conv.student_status !== 'active') throw new SupportError(409, 'This student account is no longer active.')
    const dup = await selectRows(
      conn,
      "SELECT id FROM messages WHERE conversation_id = ? AND author_kind = 'staff' AND client_request_id = ?",
      [conversationId, data.clientRequestId],
    )
    if (dup[0]) return { messageId: Number(dup[0].id), duplicate: true }
    const [msg] = await conn.query(
      "INSERT INTO messages (conversation_id, author_kind, author_user_id, body, client_request_id) VALUES (?, 'staff', ?, ?, ?)",
      [conversationId, actor.userId, data.body, data.clientRequestId],
    )
    const messageId = Number((msg as { insertId: number }).insertId)
    // A human answered: any draft still being generated or awaiting review is now stale.
    await conn.query("UPDATE ai_drafts SET status = 'superseded' WHERE conversation_id = ? AND status IN ('generating', 'ready')", [conversationId])
    await conn.query(
      'UPDATE conversations SET last_message_at = UTC_TIMESTAMP(3), staff_last_read_id = GREATEST(staff_last_read_id, last_student_message_id) WHERE id = ?',
      [conversationId],
    )
    const to = await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'reply_sent' }, { kind: 'staff', id: actor.userId })
    await appendChangeLog(conn, {
      entityType: 'conversation',
      entityId: conversationId,
      action: 'staff_reply',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: null,
      before: { status: conv.status },
      after: { status: to, messageId, bodySha256: sha256(data.body) },
    })
    await createNotification(conn, {
      audience: 'user',
      recipientUserId: String(conv.student_user_id),
      kind: 'staff_reply',
      conversationId,
      title: 'The LockIn team replied to your question',
      targetPath: `/support?c=${conversationId}`,
    })
    return { messageId, duplicate: false }
  })
}

export async function setConversationStatus(pool: Pool, actor: AdminActor, conversationId: number, to: unknown, rawReason: unknown): Promise<ConversationStatus> {
  assertActor(actor, 'support.reply')
  if (!isConversationStatus(to)) throw new SupportError(400, 'Unknown status.')
  const reason = rawReason == null || rawReason === '' ? null : parse(reasonText, rawReason)
  return inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    let next: ConversationStatus
    try {
      next = await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'staff_set', to }, { kind: 'staff', id: actor.userId }, reason)
    } catch (e) {
      if (e instanceof TransitionError) throw new SupportError(409, e.message)
      throw e
    }
    await appendChangeLog(conn, {
      entityType: 'conversation',
      entityId: conversationId,
      action: 'status_change',
      actorId: actor.userId,
      actorRole: actor.role,
      reason,
      before: { status: conv.status },
      after: { status: next },
    })
    return next
  })
}

/**
 * A team member takes the conversation over from Derek: no new drafts start for it, a draft that
 * is still being written is discarded, and nothing is sent automatically until someone returns it.
 * Drafts that are already ready stay visible for the team to use. Idempotent.
 */
export async function takeOverConversation(pool: Pool, actor: AdminActor, conversationId: number): Promise<void> {
  assertActor(actor, 'support.reply')
  await inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    if (conv.ai_paused_by != null) return
    await conn.query('UPDATE conversations SET ai_paused_by = ?, ai_paused_at = UTC_TIMESTAMP(3) WHERE id = ?', [actor.userId, conversationId])
    await conn.query("UPDATE ai_drafts SET status = 'superseded' WHERE conversation_id = ? AND status = 'generating'", [conversationId])
    await recordNote(conn, conv, actor, 'Taken over from Derek by a team member')
    await appendChangeLog(conn, {
      entityType: 'conversation',
      entityId: conversationId,
      action: 'ai_takeover',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: null,
      before: { aiPaused: false },
      after: { aiPaused: true },
    })
  })
}

/** Explicitly hands the conversation back to Derek's normal drafting (and Auto Mode, if on). */
export async function returnToDerek(pool: Pool, actor: AdminActor, conversationId: number): Promise<void> {
  // Re-enabling unreviewed AI handling is a reviewer decision, never delegated to editors.
  assertActor(actor, 'support.review_ai')
  await inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    if (conv.ai_paused_by == null) return
    await conn.query('UPDATE conversations SET ai_paused_by = NULL, ai_paused_at = NULL WHERE id = ?', [conversationId])
    await recordNote(conn, conv, actor, 'Returned to Derek by a team member')
    await appendChangeLog(conn, {
      entityType: 'conversation',
      entityId: conversationId,
      action: 'ai_return',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: null,
      before: { aiPaused: true },
      after: { aiPaused: false },
    })
  })
}

/** A history entry that does not change the status (from = to). */
async function recordNote(conn: PoolConnection, conv: Row & { status: ConversationStatus }, actor: AdminActor, reason: string) {
  await conn.query('INSERT INTO conversation_events (conversation_id, from_status, to_status, actor_kind, actor_id, reason) VALUES (?, ?, ?, ?, ?, ?)', [
    Number(conv.id),
    conv.status,
    conv.status,
    'staff',
    actor.userId,
    reason,
  ])
}

// ---------------------------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------------------------

export const STUDENTS_PAGE_SIZE = 25

export async function listStudents(db: Db, actor: AdminActor, { page = 1 }: { page?: number } = {}) {
  assertActor(actor, 'students.read')
  const [rows, [count]] = await Promise.all([
    selectRows(
      db,
      `SELECT sp.id, sp.display_name, sp.status, sp.created_at, u.email,
              (SELECT COUNT(*) FROM conversations c WHERE c.student_profile_id = sp.id) AS conversations
         FROM student_profiles sp LEFT JOIN auth_user u ON u.id = sp.user_id
        ORDER BY sp.created_at DESC, sp.id DESC LIMIT ? OFFSET ?`,
      [STUDENTS_PAGE_SIZE, (Math.max(1, page) - 1) * STUDENTS_PAGE_SIZE],
    ),
    selectRows(db, 'SELECT COUNT(*) AS n FROM student_profiles'),
  ])
  return {
    total: Number(count.n),
    rows: rows.map((r) => ({
      id: Number(r.id),
      displayName: String(r.display_name),
      status: String(r.status),
      email: r.email == null ? null : String(r.email),
      createdAt: String(r.created_at),
      conversations: Number(r.conversations),
    })),
  }
}

export async function getStudent(db: Db, actor: AdminActor, profileId: number) {
  assertActor(actor, 'students.read')
  const rows = await selectRows(
    db,
    `SELECT sp.id, sp.display_name, sp.status, sp.created_at, sp.erased_at, sp.age_confirmed_at, sp.privacy_notice_version, u.email
       FROM student_profiles sp LEFT JOIN auth_user u ON u.id = sp.user_id WHERE sp.id = ?`,
    [profileId],
  )
  if (!rows[0]) throw new SupportError(404, 'Student not found.')
  const r = rows[0]
  // Conversation subjects are listed only for staff who may read support conversations.
  const conversations = actorCan(actor, 'support.read')
    ? await selectRows(db, 'SELECT id, subject, status, last_message_at FROM conversations WHERE student_profile_id = ? ORDER BY last_message_at DESC LIMIT 100', [profileId])
    : []
  return {
    id: Number(r.id),
    displayName: String(r.display_name),
    status: String(r.status),
    email: r.email == null ? null : String(r.email),
    createdAt: String(r.created_at),
    erasedAt: r.erased_at == null ? null : String(r.erased_at),
    ageConfirmedAt: r.age_confirmed_at == null ? null : String(r.age_confirmed_at),
    privacyNoticeVersion: r.privacy_notice_version == null ? null : String(r.privacy_notice_version),
    conversations: conversations.map((c) => ({ id: Number(c.id), subject: String(c.subject), status: c.status as ConversationStatus, lastMessageAt: String(c.last_message_at) })),
  }
}

/**
 * Owner-only erasure: deletes the student's conversations (messages, drafts, events and
 * notifications cascade), their notifications and read marks, and their auth account and
 * sessions, then leaves a scrubbed tombstone. The audit entry records counts, never content.
 */
export async function eraseStudent(pool: Pool, actor: AdminActor, profileId: number, rawReason: unknown): Promise<{ conversations: number }> {
  assertActor(actor, 'students.erase')
  const reason = parse(reasonText, rawReason ?? '')
  return inTransaction(pool, async (conn) => {
    const rows = await selectRows(conn, 'SELECT * FROM student_profiles WHERE id = ? FOR UPDATE', [profileId])
    const profile = rows[0]
    if (!profile) throw new SupportError(404, 'Student not found.')
    if (profile.status === 'erased') throw new SupportError(409, 'This student has already been erased.')
    const userId = profile.user_id == null ? null : String(profile.user_id)
    const [del] = await conn.query('DELETE FROM conversations WHERE student_profile_id = ?', [profileId])
    const conversations = Number((del as { affectedRows: number }).affectedRows)
    if (userId) {
      await conn.query("DELETE FROM notifications WHERE audience = 'user' AND recipient_user_id = ?", [userId])
      await conn.query('DELETE FROM notification_reads WHERE user_id = ?', [userId])
    }
    await conn.query(
      "UPDATE student_profiles SET status = 'erased', erased_at = UTC_TIMESTAMP(3), display_name = 'Erased student', user_id = NULL, age_confirmed_at = NULL, privacy_notice_version = NULL WHERE id = ?",
      [profileId],
    )
    if (userId) {
      const [[member]] = await conn.query<Row[]>('SELECT COUNT(*) AS n FROM admin_members WHERE user_id = ?', [userId])
      if (Number(member.n) === 0) await conn.query('DELETE FROM auth_user WHERE id = ?', [userId])
    }
    await appendChangeLog(conn, {
      entityType: 'student_profile',
      entityId: profileId,
      action: 'student_erase',
      actorId: actor.userId,
      actorRole: actor.role,
      reason,
      before: { status: String(profile.status) },
      after: { status: 'erased', conversationsDeleted: conversations },
    })
    return { conversations }
  })
}
