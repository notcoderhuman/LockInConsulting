import type { PoolConnection } from 'mysql2/promise'
import { selectRows, type Row } from '@/lib/support/db'
import { autoReplyActive, type SupportSettings } from '@/lib/support/settings'
import type { DerekStatus } from './config'
import type { AiProvider, EvidenceItem } from './provider'
import type { RiskLevel } from './safeguards'
import { styleIssues } from './style'

// The last gate before Derek sends a reply that nobody reviewed ("Auto Mode", offline only).
// Called by the draft worker inside the conversation lock, after the draft was checked against the
// verified evidence (lib/derek/safeguards.ts). Anything it declines stays a draft in the Live
// Inbox for a person, with the reason recorded; nothing is ever lost or sent twice.

export const AUTO_REPLY_LIMITS = {
  /** Auto replies are for short, ordinary answers; anything longer waits for a person. */
  maxChars: 900,
  perStudentPerDay: 10,
  globalPerHour: 60,
  globalPerDay: 300,
}

const REFUSAL =
  /\bI(?: can(?:'|’)?t| cannot| am (?:not able|unable) to|(?:'|’)m (?:not able|unable) to) (?:help|answer|assist|provide)\b|\bas an AI\b|\bI(?:'|’)m sorry,? (?:but )?I can(?:'|’)?t\b/i

const trimUrl = (u: string) => u.replace(/[),.;:!?'"’”\]]+$/, '')

/** Reasons the draft's text is not suitable to send unreviewed. Empty = suitable. */
export function autoReplyContentBlockers(text: string, evidence: EvidenceItem[]): string[] {
  const reasons: string[] = []
  if (text.length > AUTO_REPLY_LIMITS.maxChars) reasons.push(`Longer than ${AUTO_REPLY_LIMITS.maxChars} characters`)
  const allowed = new Set(evidence.map((e) => trimUrl(e.sourceUrl)))
  // A link a student may follow must come from a verified record, never from the model's memory.
  if ((text.match(/https?:\/\/\S+/gi) ?? []).map(trimUrl).some((u) => !allowed.has(u))) reasons.push('Contains a link that is not from verified evidence')
  if (REFUSAL.test(text)) reasons.push('Reads like a refusal')
  for (const issue of styleIssues(text)) reasons.push(`Style: ${issue}`)
  return reasons
}

export type AutoReplyDecision = { send: true } | { send: false; heldReason: string | null }

/**
 * Whether to send this low-risk draft now. `heldReason` is null when Auto Mode is simply off (the
 * normal review flow applies) and a short, fixed reason when Auto Mode is on but declined.
 * Takes the support_settings row lock, so two workers cannot both pass the shared caps.
 */
export async function decideAutoReply(
  conn: PoolConnection,
  input: {
    settings: SupportSettings
    status: DerekStatus
    provider: AiProvider
    /** LockIn's own fixed text (scope refusal, clarifying question): no model wrote it. */
    builtIn?: boolean
    conv: Row
    risk: RiskLevel
    text: string
    evidence: EvidenceItem[]
  },
): Promise<AutoReplyDecision> {
  const { settings, status, provider, conv } = input
  if (!autoReplyActive(settings, status)) return { send: false, heldReason: null }
  if (input.risk !== 'low') return { send: false, heldReason: null } // already routed by risk
  const hold = (heldReason: string): AutoReplyDecision => ({ send: false, heldReason })
  // Fixed replies still need Auto Mode fully on (checked above), but no provider clearance.
  if (!input.builtIn && (status.state !== 'ready' || status.providerId !== provider.id || provider.autoReply?.permitted !== true))
    return hold('the provider that wrote this draft is not cleared for automatic replies')
  if (conv.ai_paused_by != null) return hold('a team member has taken over this conversation')
  if (conv.status === 'resolved') return hold('the conversation was resolved')
  if (conv.student_status !== 'active') return hold('the student account is not active')
  // LockIn's fixed texts are approved wording; the content checks are for model output.
  const content = input.builtIn ? [] : autoReplyContentBlockers(input.text, input.evidence)
  if (content.length) return hold(content.join('; ').toLowerCase())

  await conn.query('SELECT id FROM support_settings WHERE id = 1 FOR UPDATE')
  const [usage] = await selectRows(
    conn,
    `SELECT COUNT(*) AS day,
            COALESCE(SUM(m.created_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR), 0) AS hour,
            COALESCE(SUM(s.user_id = ?), 0) AS student
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN student_profiles s ON s.id = c.student_profile_id
      WHERE m.author_kind = 'derek' AND m.reviewed_by IS NULL AND m.created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY`,
    [String(conv.student_user_id)],
  )
  if (Number(usage.student) >= AUTO_REPLY_LIMITS.perStudentPerDay) return hold('daily automatic-reply limit for this student reached')
  if (Number(usage.hour) >= AUTO_REPLY_LIMITS.globalPerHour) return hold('hourly automatic-reply limit reached')
  if (Number(usage.day) >= AUTO_REPLY_LIMITS.globalPerDay) return hold('daily automatic-reply limit reached')
  return { send: true }
}
