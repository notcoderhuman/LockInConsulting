import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { actorCan, can, type AdminActor } from '@/lib/admin/roles'
import { isSafeTargetPath } from './validation'

// Persistent in-site notifications. Nothing here sends email, push or chat messages elsewhere.
// A viewer only ever sees (and can only mark read) notifications addressed to them personally or
// to a staff audience their CURRENT permissions include. The viewer is always derived on the
// server from the session; notification ids from the browser are filtered through the same rule.

type Db = Pick<Pool, 'query'> | PoolConnection

export type Audience = 'user' | 'staff_support' | 'staff_review'
export type NotificationKind =
  | 'new_question'
  | 'student_reply'
  | 'human_review'
  | 'draft_ready'
  | 'high_risk'
  | 'ai_failure'
  | 'review_overdue'
  | 'staff_reply'

export interface NewNotification {
  audience: Audience
  recipientUserId?: string | null
  kind: NotificationKind
  conversationId?: number | null
  title: string
  targetPath: string
  dedupeKey?: string | null
}

export interface Viewer {
  userId: string
  staffAudiences: Exclude<Audience, 'user'>[]
}

export function staffViewer(actor: AdminActor): Viewer {
  const staffAudiences: Viewer['staffAudiences'] = []
  if (actorCan(actor, 'support.read')) staffAudiences.push('staff_support')
  if (can(actor.role, 'data.review')) staffAudiences.push('staff_review')
  return { userId: actor.userId, staffAudiences }
}

export const studentViewer = (userId: string): Viewer => ({ userId, staffAudiences: [] })

export async function createNotification(conn: Db, n: NewNotification): Promise<void> {
  if (!isSafeTargetPath(n.targetPath)) throw new Error('Notification target must be a same-site path.')
  if ((n.audience === 'user') !== Boolean(n.recipientUserId)) throw new Error('A user notification needs exactly one recipient.')
  await conn.query(
    `INSERT ${n.dedupeKey ? 'IGNORE ' : ''}INTO notifications (audience, recipient_user_id, kind, conversation_id, title, target_path, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [n.audience, n.audience === 'user' ? n.recipientUserId : null, n.kind, n.conversationId ?? null, n.title.slice(0, 200), n.targetPath, n.dedupeKey ?? null],
  )
}

function visibility(viewer: Viewer): { sql: string; params: unknown[] } {
  if (!viewer.staffAudiences.length) return { sql: "(n.audience = 'user' AND n.recipient_user_id = ?)", params: [viewer.userId] }
  return {
    sql: "((n.audience = 'user' AND n.recipient_user_id = ?) OR n.audience IN (?))",
    params: [viewer.userId, viewer.staffAudiences],
  }
}

export interface NotificationItem {
  id: number
  kind: NotificationKind
  title: string
  targetPath: string
  conversationId: number | null
  createdAt: string
  read: boolean
}

export async function listNotifications(
  db: Db,
  viewer: Viewer,
  { limit = 30, before = null, unreadOnly = false }: { limit?: number; before?: number | null; unreadOnly?: boolean } = {},
): Promise<NotificationItem[]> {
  const v = visibility(viewer)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT n.id, n.kind, n.title, n.target_path, n.conversation_id, n.created_at, r.read_at
       FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
      WHERE ${v.sql} ${before ? 'AND n.id < ?' : ''} ${unreadOnly ? 'AND r.read_at IS NULL' : ''}
      ORDER BY n.id DESC LIMIT ?`,
    [viewer.userId, ...v.params, ...(before ? [before] : []), Math.min(Math.max(limit, 1), 100)],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    title: String(r.title),
    targetPath: String(r.target_path),
    conversationId: r.conversation_id == null ? null : Number(r.conversation_id),
    createdAt: String(r.created_at),
    read: r.read_at != null,
  }))
}

export async function countUnreadNotifications(db: Db, viewer: Viewer): Promise<number> {
  const v = visibility(viewer)
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
      WHERE ${v.sql} AND r.read_at IS NULL`,
    [viewer.userId, ...v.params],
  )
  return Number(row.n)
}

/** Marks the given ids read, silently skipping any the viewer is not allowed to see. */
export async function markNotificationsRead(db: Db, viewer: Viewer, ids: number[] | 'all'): Promise<number> {
  const v = visibility(viewer)
  const list = ids === 'all' ? null : ids.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 200)
  if (list && !list.length) return 0
  const [res] = await db.query(
    `INSERT IGNORE INTO notification_reads (notification_id, user_id)
     SELECT n.id, ? FROM notifications n WHERE ${v.sql} ${list ? 'AND n.id IN (?)' : ''}`,
    [viewer.userId, ...v.params, ...(list ? [list] : [])],
  )
  return Number((res as { affectedRows?: number }).affectedRows ?? 0)
}

/** Marks every notification about one conversation read for this viewer (opening it). */
export async function markConversationNotificationsRead(db: Db, viewer: Viewer, conversationId: number): Promise<void> {
  const v = visibility(viewer)
  await db.query(
    `INSERT IGNORE INTO notification_reads (notification_id, user_id)
     SELECT n.id, ? FROM notifications n WHERE ${v.sql} AND n.conversation_id = ?`,
    [viewer.userId, ...v.params, conversationId],
  )
}

/**
 * One notification per overdue published directory record and review date, for reviewers.
 * Idempotent (dedupe_key), so it is safe to run on every Overview / Notifications page load.
 */
export async function syncOverdueReviewNotifications(
  db: Db,
  overdue: { entity: string; id: number; title: string; reviewDueAt: string | null; validTo: string | null; href: string }[],
): Promise<void> {
  for (const item of overdue) {
    await createNotification(db, {
      audience: 'staff_review',
      kind: 'review_overdue',
      title: `Review overdue: ${item.title}`.slice(0, 200),
      targetPath: item.href,
      dedupeKey: `review_overdue:${item.entity}:${item.id}:${item.reviewDueAt ?? item.validTo ?? 'none'}`.slice(0, 191),
    })
  }
}
