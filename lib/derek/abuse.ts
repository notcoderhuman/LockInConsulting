import type { Pool, PoolConnection } from 'mysql2/promise'
import { BUSINESS } from '@/lib/legal/notice'
import { mailer, restrictionMessage } from '@/lib/mail'
import { selectRows, type Row } from '@/lib/support/db'
import { createNotification } from '@/lib/support/notifications'
import { INTERNALS_REPLY, OFF_TOPIC_REPLY, SECURITY_REPLY, WARNING_REPLY, type Misuse } from './scope'
import { redactPersonalData } from './safeguards'

// What happens when a student's message is misuse (Owner brief, 13 Nov 2026). Runs inside the draft worker's claim transaction, with the
// conversation already locked, so one message is judged once and two workers cannot both restrict an account.
//
//   Category A  ordinary off-topic, or a question about LockIn's internals: a polite refusal, recorded, never a ban.
//   Category B  the same kind of request repeated within an hour: a firm warning, then a short cooldown in which Derek does not reply
//               and the team is told once.
//   Category C  an attempt to obtain credentials, secrets, other students' information or access: refused at once and recorded with a
//               short redacted excerpt; the third within 30 days restricts the account (student_profiles.status = 'suspended') and
//               sends the student the restriction email, exactly once.
// A genuine university question never reaches this module: lib/derek/scope.ts only reports misuse for explicit targets or techniques.

export const ABUSE = {
  /** Requests of category A/B in this window are counted together. */
  windowMinutes: 60,
  warnAt: 3,
  cooldownAt: 5,
  cooldownMinutes: 30,
  /** Category C attempts that restrict the account, counted over this many days. */
  restrictAt: 3,
  securityDays: 30,
} as const

export type MisuseAction = 'refused' | 'warned' | 'cooldown' | 'blocked' | 'restricted'
export interface MisuseOutcome {
  action: MisuseAction
  /** LockIn's own fixed reply; null while the account is in a cooldown (Derek stays silent and the team is told). */
  reply: string | null
  incidentId: number
  restrictionId: number | null
}

export const RESTRICTED_REPLY = 'Chat access on your account has been restricted. We have emailed you the details and how to ask for a review.'
export const RESTRICTION_POLICY = 'Security and acceptable use'
export const RESTRICTION_REASON = 'Repeated attempts to obtain access to LockIn’s systems, accounts or other people’s information.'

const REPLIES: Record<Misuse['kind'], string> = { security: SECURITY_REPLY, internals: INTERNALS_REPLY, injection: OFF_TOPIC_REPLY, off_topic: OFF_TOPIC_REPLY }

/** Records one misuse message and decides what happens. Idempotent per message: a retry returns the first decision. */
export async function recordMisuse(
  conn: PoolConnection,
  input: { studentProfileId: number; conversationId: number; messageId: number; misuse: Misuse; excerpt: string; now?: Date },
): Promise<MisuseOutcome> {
  const { studentProfileId, conversationId, messageId, misuse } = input
  await conn.query('SELECT id FROM student_profiles WHERE id = ? FOR UPDATE', [studentProfileId])
  const [seen] = await selectRows(conn, 'SELECT i.id, i.action, r.id AS restrictionId FROM student_abuse_incidents i LEFT JOIN student_restrictions r ON r.incident_id = i.id WHERE i.message_id = ?', [messageId])
  if (seen) return outcomeFor(misuse, seen.action as MisuseAction, Number(seen.id), seen.restrictionId == null ? null : Number(seen.restrictionId))

  // A restriction that staff lifted starts the count again.
  const [fresh] = await selectRows(conn, "SELECT COALESCE(MAX(reviewed_at), '1970-01-01') AS since FROM student_restrictions WHERE student_profile_id = ? AND status = 'lifted'", [studentProfileId])
  const since = fresh.since
  const [counts] = await selectRows(
    conn,
    `SELECT COALESCE(SUM(kind = 'security' AND created_at > GREATEST(UTC_TIMESTAMP(3) - INTERVAL ? DAY, ?)), 0) AS security,
            COALESCE(SUM(kind <> 'security' AND created_at > GREATEST(UTC_TIMESTAMP(3) - INTERVAL ? MINUTE, ?)), 0) AS recent,
            COALESCE(SUM(action = 'cooldown' AND created_at > GREATEST(UTC_TIMESTAMP(3) - INTERVAL ? MINUTE, ?)), 0) AS cooling
       FROM student_abuse_incidents WHERE student_profile_id = ?`,
    [ABUSE.securityDays, since, ABUSE.windowMinutes, since, ABUSE.cooldownMinutes, since, studentProfileId],
  )

  let action: MisuseAction
  let category: 'A' | 'B' | 'C'
  if (misuse.kind === 'security') {
    category = 'C'
    action = Number(counts.security) + 1 >= ABUSE.restrictAt ? 'restricted' : 'blocked'
  } else {
    const n = Number(counts.recent) + 1
    category = n >= ABUSE.warnAt ? 'B' : 'A'
    action = n >= ABUSE.cooldownAt || Number(counts.cooling) > 0 ? 'cooldown' : n >= ABUSE.warnAt ? 'warned' : 'refused'
  }

  const [res] = await conn.query('INSERT INTO student_abuse_incidents (student_profile_id, conversation_id, message_id, category, kind, reason, evidence, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    studentProfileId,
    conversationId,
    messageId,
    category,
    misuse.kind,
    misuse.reason.slice(0, 300),
    misuse.kind === 'off_topic' && category === 'A' ? null : redactPersonalData(input.excerpt).replace(/\s+/g, ' ').slice(0, 300),
    action,
  ])
  const incidentId = Number((res as { insertId: number }).insertId)

  let restrictionId: number | null = null
  if (action === 'restricted') {
    await conn.query("UPDATE student_profiles SET status = 'suspended' WHERE id = ? AND status = 'active'", [studentProfileId])
    const [r] = await conn.query('INSERT INTO student_restrictions (student_profile_id, incident_id, policy, reason) VALUES (?, ?, ?, ?)', [studentProfileId, incidentId, RESTRICTION_POLICY, RESTRICTION_REASON])
    restrictionId = Number((r as { insertId: number }).insertId)
  }

  // The team hears about every security attempt and every escalation, once.
  if (misuse.kind === 'security' || action === 'warned' || action === 'cooldown') {
    const hour = Math.floor((input.now ?? new Date()).getTime() / 3_600_000)
    await createNotification(conn, {
      audience: 'staff_support',
      kind: 'high_risk',
      conversationId,
      title:
        action === 'restricted'
          ? `A student account was restricted after repeated security attempts (conversation #${conversationId}) — please review`
          : misuse.kind === 'security'
            ? `A student tried to obtain credentials or access in conversation #${conversationId} — Derek refused`
            : `A student keeps sending unrelated or unsafe requests in conversation #${conversationId} (${action}) — please review`,
      targetPath: `/admin/inbox/${conversationId}`,
      dedupeKey: misuse.kind === 'security' ? `abuse:${incidentId}` : `abuse-repeat:${studentProfileId}:${action}:${hour}`,
    })
  }
  return outcomeFor(misuse, action, incidentId, restrictionId)
}

function outcomeFor(misuse: Misuse, action: MisuseAction, incidentId: number, restrictionId: number | null): MisuseOutcome {
  const reply = action === 'restricted' ? RESTRICTED_REPLY : action === 'cooldown' ? null : action === 'warned' ? WARNING_REPLY : REPLIES[misuse.kind]
  return { action, reply, incidentId, restrictionId }
}

/**
 * Sends the restriction email for one restriction, at most once: the send is claimed with a conditional UPDATE, so two workers (or a retry)
 * cannot both send. A failed send releases the claim and records a short code for staff, who can resend from the student's page.
 */
export async function sendRestrictionEmail(db: Pool, restrictionId: number): Promise<'sent' | 'skipped' | 'failed'> {
  const [claimed] = await db.query(
    'UPDATE student_restrictions SET email_claimed_at = UTC_TIMESTAMP(3), email_error = NULL WHERE id = ? AND email_sent_at IS NULL AND (email_claimed_at IS NULL OR email_claimed_at < UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE)',
    [restrictionId],
  )
  if ((claimed as { affectedRows: number }).affectedRows !== 1) return 'skipped'
  const [row] = await selectRows(
    db,
    'SELECT r.policy, r.reason, r.created_at AS createdAt, u.email AS email FROM student_restrictions r JOIN student_profiles s ON s.id = r.student_profile_id LEFT JOIN auth_user u ON u.id = s.user_id WHERE r.id = ?',
    [restrictionId],
  )
  const fail = async (code: string): Promise<'failed'> => {
    await db.query('UPDATE student_restrictions SET email_claimed_at = NULL, email_error = ? WHERE id = ?', [code, restrictionId])
    return 'failed'
  }
  if (!row?.email) return fail('no_email')
  try {
    const date = (row.createdAt instanceof Date ? row.createdAt : new Date(`${String(row.createdAt).replace(' ', 'T')}Z`)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    await mailer.send(restrictionMessage({ email: String(row.email), policy: String(row.policy), reason: String(row.reason), date, contactEmail: BUSINESS.contactEmail }))
  } catch (error) {
    console.error('[derek] restriction email failed', error instanceof Error ? error.name : 'unknown')
    return fail('send_failed')
  }
  await db.query('UPDATE student_restrictions SET email_sent_at = UTC_TIMESTAMP(3) WHERE id = ?', [restrictionId])
  return 'sent'
}

export type Restriction = Row & { id: number; status: 'active' | 'appealed' | 'lifted' }

/** The restriction currently in force for a student, or null. */
export async function activeRestriction(db: Pick<Pool, 'query'>, studentProfileId: number): Promise<Row | null> {
  const [row] = await selectRows(db, "SELECT id, status, policy, reason, created_at AS createdAt, email_sent_at AS emailSentAt, email_error AS emailError FROM student_restrictions WHERE student_profile_id = ? AND status <> 'lifted' ORDER BY id DESC LIMIT 1", [studentProfileId])
  return row ?? null
}

/** Staff review: lift the restriction (the student can chat again and the count starts again) or uphold it, with a note. */
export async function reviewRestriction(db: Pool, restrictionId: number, reviewer: string, decision: 'lift' | 'uphold', note: string): Promise<void> {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [r] = await selectRows(conn, 'SELECT id, student_profile_id AS studentId, status FROM student_restrictions WHERE id = ? FOR UPDATE', [restrictionId])
    if (!r || r.status === 'lifted') throw new Error('This restriction is not active.')
    await conn.query('UPDATE student_restrictions SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = UTC_TIMESTAMP(3) WHERE id = ?', [decision === 'lift' ? 'lifted' : 'active', reviewer.slice(0, 191), note.slice(0, 500), restrictionId])
    if (decision === 'lift') await conn.query("UPDATE student_profiles SET status = 'active' WHERE id = ? AND status = 'suspended'", [Number(r.studentId)])
    await conn.commit()
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}
