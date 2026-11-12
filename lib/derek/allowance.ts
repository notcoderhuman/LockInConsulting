import type { Pool, PoolConnection } from 'mysql2/promise'
import { isDuplicate, selectRows } from '@/lib/support/db'

// Derek's daily allowance: at most 10 delivered AI answers per student account per Indian calendar day
// (Asia/Kolkata), shared by all of the student's conversations, tabs and devices. Enforced here and by
// CHECK (delivered <= 10) in 0017_derek_allowance.sql; the browser only displays it.
//
//   reserve   before a draft's generation starts: takes a slot for this draft (UNIQUE per draft, so a retry is the
//             same slot) or reports that none is left. The student's day row is locked first, so tabs racing for
//             the last slot are serialised and exactly one wins.
//   commit    in the SAME transaction that saves Derek's message: the slot becomes a delivered answer.
//   release   generation failed, or the answer was held for a person: the slot goes back.
//   expiry    a hold left behind by a crashed process stops counting after HOLD_SECONDS and is reused or released.
//
// Counted: Derek's AI answers, preliminary ones included, also those sent when Derek resumes after Dev leaves.
// Not counted: any human reply (including a Derek draft a team member approved), LockIn's fixed replies,
// suggested-question clicks, notices, failures, duplicates.

export const DEREK_DAILY_LIMIT = 10
/** Long enough for research plus two provider attempts; after it a crashed worker's slot is free again. */
export const HOLD_SECONDS = 180

type Db = Pick<Pool, 'query'> | PoolConnection

const IST_OFFSET_MS = 330 * 60_000

/** The Indian calendar day (YYYY-MM-DD) of an instant. Midnight IST is 18:30 UTC. */
export function istDay(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** When the allowance next resets: the coming midnight IST, as an ISO instant. */
export function nextIstMidnight(now: Date = new Date()): Date {
  const day = istDay(now)
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000 - IST_OFFSET_MS)
}

export interface Allowance {
  limit: number
  used: number
  remaining: number
  /** The coming midnight IST (ISO). */
  resetsAt: string
}

async function counts(db: Db, studentProfileId: number, day: string) {
  const [row] = await selectRows(
    db,
    `SELECT COALESCE((SELECT delivered FROM derek_allowance_days WHERE student_profile_id = ? AND quota_date = ?), 0) AS delivered,
            (SELECT COUNT(*) FROM derek_allowance_holds WHERE student_profile_id = ? AND quota_date = ? AND status = 'held' AND expires_at > UTC_TIMESTAMP(3)) AS held`,
    [studentProfileId, day, studentProfileId, day],
  )
  return { delivered: Number(row.delivered), held: Number(row.held) }
}

/** What the student sees: slots used today (delivered or being generated) and left. Read-only. */
export async function getAllowance(db: Db, studentProfileId: number, now: Date = new Date()): Promise<Allowance> {
  const { delivered, held } = await counts(db, studentProfileId, istDay(now))
  const used = Math.min(DEREK_DAILY_LIMIT, delivered + held)
  return { limit: DEREK_DAILY_LIMIT, used, remaining: DEREK_DAILY_LIMIT - used, resetsAt: nextIstMidnight(now).toISOString() }
}

async function lockDay(conn: PoolConnection, studentProfileId: number, day: string) {
  await conn.query('INSERT IGNORE INTO derek_allowance_days (student_profile_id, quota_date, delivered) VALUES (?, ?, 0)', [studentProfileId, day])
  await conn.query('SELECT delivered FROM derek_allowance_days WHERE student_profile_id = ? AND quota_date = ? FOR UPDATE', [studentProfileId, day])
}

/** Takes a slot for this draft inside the caller's transaction. False: none left (nothing is held). */
export async function reserveAllowance(conn: PoolConnection, studentProfileId: number, draftId: number, now: Date = new Date()): Promise<boolean> {
  const day = istDay(now)
  await lockDay(conn, studentProfileId, day)
  // Give back what crashed workers left behind, then look at this draft's own hold.
  await conn.query("UPDATE derek_allowance_holds SET status = 'released' WHERE student_profile_id = ? AND status = 'held' AND expires_at <= UTC_TIMESTAMP(3)", [studentProfileId])
  const [existing] = await selectRows(conn, 'SELECT id, status, quota_date FROM derek_allowance_holds WHERE draft_id = ? FOR UPDATE', [draftId])
  if (existing?.status === 'committed') return true
  const { delivered, held } = await counts(conn, studentProfileId, day)
  const mine = existing?.status === 'held' && String(existing.quota_date).slice(0, 10) === day ? 1 : 0
  if (delivered + held - mine >= DEREK_DAILY_LIMIT) return false
  if (existing) await conn.query("UPDATE derek_allowance_holds SET status = 'held', quota_date = ?, expires_at = UTC_TIMESTAMP(3) + INTERVAL ? SECOND WHERE id = ?", [day, HOLD_SECONDS, existing.id])
  else {
    try {
      await conn.query("INSERT INTO derek_allowance_holds (student_profile_id, quota_date, draft_id, status, expires_at) VALUES (?, ?, ?, 'held', UTC_TIMESTAMP(3) + INTERVAL ? SECOND)", [studentProfileId, day, draftId, HOLD_SECONDS])
    } catch (e) {
      if (!isDuplicate(e)) throw e
    }
  }
  return true
}

/**
 * Turns the draft's slot into a delivered answer. Call in the transaction that inserts Derek's message, after the
 * insert succeeded. Takes a fresh slot if the hold was released or expired; returns false (and counts nothing) when
 * the day is full, in which case the caller must roll back the message.
 */
export async function commitAllowance(conn: PoolConnection, studentProfileId: number, draftId: number, now: Date = new Date()): Promise<boolean> {
  if (!(await reserveAllowance(conn, studentProfileId, draftId, now))) return false
  const [hold] = await selectRows(conn, 'SELECT id, status, quota_date FROM derek_allowance_holds WHERE draft_id = ? FOR UPDATE', [draftId])
  if (!hold || hold.status === 'committed') return Boolean(hold)
  await conn.query("UPDATE derek_allowance_holds SET status = 'committed' WHERE id = ?", [hold.id])
  await conn.query('UPDATE derek_allowance_days SET delivered = delivered + 1 WHERE student_profile_id = ? AND quota_date = ?', [studentProfileId, String(hold.quota_date).slice(0, 10)])
  return true
}

/** Gives the draft's slot back (failure, or an answer held for a person). A committed slot is never released. */
export async function releaseAllowance(db: Db, draftId: number): Promise<void> {
  await db.query("UPDATE derek_allowance_holds SET status = 'released' WHERE draft_id = ? AND status = 'held'", [draftId])
}

/** Shown in the chat when the day's allowance is used up. Static: it is never a Derek answer and never counts. */
export const ALLOWANCE_NOTICE =
  `You have used today’s ${DEREK_DAILY_LIMIT} Derek answers. Derek can answer again after midnight India time (12:00 am IST). You can keep messaging: Dev and the LockIn team read every message and reply as soon as they can, which may take a while.`
