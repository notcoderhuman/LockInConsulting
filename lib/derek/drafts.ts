import type { Pool, PoolConnection } from 'mysql2/promise'
import { appendChangeLog } from '@/lib/admin/audit'
import type { AdminActor } from '@/lib/admin/roles'
import { applyEvent, lockConversation } from '@/lib/support/conversations'
import { assertActor, inTransaction, isDuplicate, selectRows, sha256, SupportError, type Row } from '@/lib/support/db'
import { createNotification } from '@/lib/support/notifications'
import { autoReplyActive, getSupportSettings } from '@/lib/support/settings'
import { TransitionError } from '@/lib/support/state'
import { messageBody, reasonText } from '@/lib/support/validation'
import { createProvider, derekMaxAttempts, getDerekStatus, type DerekStatus } from './config'
import { loadEvidence } from './evidence'
import { analyseQuestion } from './guidance'
import { DEREK_INSTRUCTIONS, type AiProvider, type EvidenceItem } from './provider'
import { callProvider } from './runtime'
import { assessDraft, assessQuestion, redactPersonalData } from './safeguards'
import { tidyDraft } from './style'

// Derek's draft lifecycle.
//
//   student message ──► claim (INSERT ai_drafts, UNIQUE per message) ──► provider call (no locks held)
//     ├─ failure/timeout ──► draft 'failed', conversation 'failed', reviewers notified. The
//     │                      student's message is already saved and stays in the inbox.
//     └─ text ──► safeguards ──► revision 1 ──► draft 'ready'
//            ├─ automatic replies fully permitted AND risk 'low' AND still unanswered ──► sent as Derek
//            └─ otherwise ──► conversation 'awaiting_human_review' (+ high-risk notification)
//
//   reviewer: edit (new revision; old approvals no longer match) → approve exact revision+hash →
//   send. Or reject with a reason, or simply write a human reply (which supersedes the draft).
//
// Races: the worker re-locks the conversation before writing and gives up if a human replied
// meanwhile; a human reply marks open drafts 'superseded'; messages.draft_id is UNIQUE.

export type WorkerOutcome =
  | { state: 'disabled' }
  | { state: 'duplicate' }
  | { state: 'stale' }
  | { state: 'ineligible' } // provider policy forbids this student (no recorded 18+ confirmation)
  | { state: 'quota' } // provider's daily draft cap reached
  | { state: 'superseded'; draftId: number }
  | { state: 'failed'; draftId: number; code: string }
  | { state: 'review'; draftId: number; risk: string }
  | { state: 'auto_sent'; draftId: number; messageId: number }

export interface WorkerDeps {
  status?: DerekStatus
  provider?: AiProvider | null
  callOptions?: Parameters<typeof callProvider>[2]
  loadEvidence?: (db: Pool, question: string) => Promise<EvidenceItem[]>
}

const HISTORY_TURNS = 6

export async function prepareDerekDraft(pool: Pool, conversationId: number, triggerMessageId: number, deps: WorkerDeps = {}): Promise<WorkerOutcome> {
  const status = deps.status ?? getDerekStatus()
  const provider = deps.provider === undefined ? createProvider(status) : deps.provider
  if (status.state !== 'ready' || !provider) return { state: 'disabled' }

  // 1. Claim the question. The UNIQUE key on trigger_message_id makes this the only worker.
  const claim = await inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    const [trigger] = await selectRows(conn, "SELECT id, body FROM messages WHERE id = ? AND conversation_id = ? AND author_kind = 'student'", [triggerMessageId, conversationId])
    if (!trigger || conv.status === 'resolved' || conv.student_status !== 'active') return null
    const [answered] = await selectRows(conn, "SELECT id FROM messages WHERE conversation_id = ? AND id > ? AND author_kind <> 'student' LIMIT 1", [conversationId, triggerMessageId])
    if (answered) return null
    // External-provider policy, checked before anything leaves this server. The question stays in
    // the Live Inbox for a human either way.
    if (provider.policy?.requiresAdultStudent && conv.student_age_confirmed_at == null) return 'ineligible' as const
    if (provider.policy?.external) {
      // Serialise external claims on the settings row so concurrent workers cannot overshoot the cap.
      await conn.query('SELECT id FROM support_settings WHERE id = 1 FOR UPDATE')
      const [[used]] = await conn.query<Row[]>('SELECT COUNT(*) AS n FROM ai_drafts WHERE provider = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY', [provider.id])
      if (Number(used.n) >= provider.policy.dailyDraftLimit) return 'quota' as const
    }
    try {
      const [res] = await conn.query("INSERT INTO ai_drafts (conversation_id, trigger_message_id, status, provider, model) VALUES (?, ?, 'generating', ?, ?)", [
        conversationId,
        triggerMessageId,
        provider.id,
        provider.model,
      ])
      return { draftId: Number((res as { insertId: number }).insertId), question: String(trigger.body) }
    } catch (e) {
      if (isDuplicate(e)) return 'duplicate' as const
      throw e
    }
  })
  if (claim === 'duplicate') return { state: 'duplicate' }
  if (claim === 'ineligible') return { state: 'ineligible' }
  if (claim === 'quota') return { state: 'quota' }
  if (!claim) return { state: 'stale' }

  // 2. Build the request from redacted text and verified evidence only. No lock is held during
  //    the provider call.
  const historyRows = await selectRows(
    pool,
    'SELECT author_kind, body FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
    [conversationId, triggerMessageId, HISTORY_TURNS],
  )
  const question = redactPersonalData(claim.question)
  const evidence = await (deps.loadEvidence ?? loadEvidence)(pool, claim.question)
  const history = historyRows.reverse().map((r) => ({ role: r.author_kind === 'student' ? ('student' as const) : ('team' as const), text: redactPersonalData(String(r.body)) }))
  const guidance = analyseQuestion(
    question,
    evidence,
    history.filter((h) => h.role === 'student').map((h) => h.text).join('\n'),
  )
  const outcome = await callProvider(
    provider,
    { question, history, evidence, instructions: DEREK_INSTRUCTIONS, guidance },
    deps.callOptions ?? { maxAttempts: derekMaxAttempts() },
  )

  // 3. Record the result under the conversation lock.
  return inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    const [draft] = await selectRows(conn, 'SELECT * FROM ai_drafts WHERE id = ? FOR UPDATE', [claim.draftId])
    if (!draft || draft.status !== 'generating') return { state: 'superseded', draftId: claim.draftId }
    const [answered] = await selectRows(conn, "SELECT id FROM messages WHERE conversation_id = ? AND id > ? AND author_kind <> 'student' LIMIT 1", [conversationId, triggerMessageId])
    if (answered || Number(conv.last_student_message_id) !== triggerMessageId) {
      await conn.query("UPDATE ai_drafts SET status = 'superseded' WHERE id = ?", [claim.draftId])
      return { state: 'superseded', draftId: claim.draftId }
    }

    if (!outcome.ok) {
      await conn.query("UPDATE ai_drafts SET status = 'failed', error_code = ?, attempts = ?, latency_ms = ? WHERE id = ?", [
        outcome.code,
        outcome.attempts,
        outcome.latencyMs,
        claim.draftId,
      ])
      try {
        await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'ai_failed' }, { kind: 'system', id: null }, `Derek ${outcome.code}`)
      } catch (e) {
        if (!(e instanceof TransitionError)) throw e
      }
      await createNotification(conn, {
        audience: 'staff_support',
        kind: 'ai_failure',
        conversationId,
        title: `Derek could not draft a reply for conversation #${conversationId} — a person needs to answer`,
        targetPath: `/admin/inbox/${conversationId}`,
      })
      return { state: 'failed', draftId: claim.draftId, code: outcome.code }
    }

    const text = messageBody.safeParse(tidyDraft(outcome.result.text))
    if (!text.success) {
      await conn.query("UPDATE ai_drafts SET status = 'failed', error_code = 'invalid_response', attempts = ? WHERE id = ?", [outcome.attempts, claim.draftId])
      await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'ai_failed' }, { kind: 'system', id: null }, 'Derek invalid_response').catch((e) => {
        if (!(e instanceof TransitionError)) throw e
      })
      return { state: 'failed', draftId: claim.draftId, code: 'invalid_response' }
    }
    const risk = assessDraft(text.data, assessQuestion(claim.question, evidence), evidence, { modelUncertain: outcome.result.uncertain })
    await conn.query(
      "INSERT INTO ai_draft_revisions (draft_id, revision, body, body_sha256, created_by_kind, created_by) VALUES (?, 1, ?, ?, 'derek', NULL)",
      [claim.draftId, text.data, sha256(text.data)],
    )
    await conn.query(
      `UPDATE ai_drafts SET status = 'ready', current_revision = 1, risk_level = ?, risk_reasons = ?, evidence_refs = ?, model = ?,
              input_tokens = ?, output_tokens = ?, latency_ms = ?, attempts = ? WHERE id = ?`,
      [
        risk.level,
        JSON.stringify(risk.reasons),
        JSON.stringify(evidence.map((e) => e.ref)),
        outcome.result.model.slice(0, 120),
        outcome.result.usage?.inputTokens ?? null,
        outcome.result.usage?.outputTokens ?? null,
        outcome.latencyMs,
        outcome.attempts,
        claim.draftId,
      ],
    )

    // Automatic reply: every gate is re-read now, inside the lock, not when the job started.
    const settings = await getSupportSettings(conn)
    const stillLatest = Number(conv.last_student_message_id) === triggerMessageId
    if (risk.level === 'low' && stillLatest && autoReplyActive(settings, getDerekStatus())) {
      const messageId = await deliverDraft(conn, conv, claim.draftId, text.data, null)
      return { state: 'auto_sent', draftId: claim.draftId, messageId }
    }

    try {
      await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'draft_needs_review' }, { kind: 'derek', id: null }, `Draft risk: ${risk.level}`)
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e
    }
    await createNotification(conn, {
      audience: 'staff_support',
      kind: risk.level === 'low' ? 'draft_ready' : 'high_risk',
      conversationId,
      title:
        risk.level === 'low'
          ? `Derek drafted a reply for conversation #${conversationId} — review before sending`
          : `${risk.level === 'high' ? 'High-risk' : 'Uncertain'} Derek draft in conversation #${conversationId} — human review required`,
      targetPath: `/admin/inbox/${conversationId}`,
    })
    return { state: 'review', draftId: claim.draftId, risk: risk.level }
  })
}

/** Inserts the Derek message for a draft. Caller holds the conversation lock. */
async function deliverDraft(conn: PoolConnection, conv: Row, draftId: number, body: string, reviewer: AdminActor | null): Promise<number> {
  const conversationId = Number(conv.id)
  let messageId: number
  try {
    const [res] = await conn.query("INSERT INTO messages (conversation_id, author_kind, author_user_id, reviewed_by, draft_id, body) VALUES (?, 'derek', NULL, ?, ?, ?)", [
      conversationId,
      reviewer?.userId ?? null,
      draftId,
      body,
    ])
    messageId = Number((res as { insertId: number }).insertId)
  } catch (e) {
    if (isDuplicate(e)) throw new SupportError(409, 'This draft has already been sent.')
    throw e
  }
  await conn.query("UPDATE ai_drafts SET status = 'sent' WHERE id = ?", [draftId])
  // Other open drafts in this conversation are now out of date.
  await conn.query("UPDATE ai_drafts SET status = 'superseded' WHERE conversation_id = ? AND id <> ? AND status IN ('generating', 'ready')", [conversationId, draftId])
  await conn.query('UPDATE conversations SET last_message_at = UTC_TIMESTAMP(3), staff_last_read_id = GREATEST(staff_last_read_id, last_student_message_id) WHERE id = ?', [conversationId])
  const to = await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'reply_sent' }, reviewer ? { kind: 'staff', id: reviewer.userId } : { kind: 'derek', id: null })
  await appendChangeLog(conn, {
    entityType: 'ai_draft',
    entityId: draftId,
    action: 'draft_send',
    actorId: reviewer?.userId ?? 'derek',
    actorRole: reviewer?.role ?? 'derek',
    reason: reviewer ? null : 'Automatic reply (offline mode)',
    before: { conversationStatus: conv.status },
    after: { conversationId, conversationStatus: to, messageId, bodySha256: sha256(body), reviewedBy: reviewer?.userId ?? null },
  })
  await createNotification(conn, {
    audience: 'user',
    recipientUserId: String(conv.student_user_id),
    kind: 'staff_reply',
    conversationId,
    title: 'Derek replied to your question',
    targetPath: `/support?c=${conversationId}`,
  })
  return messageId
}

async function lockDraft(conn: PoolConnection, draftId: number) {
  // Lock order is always conversation → draft (as in the worker), so the two cannot deadlock.
  const [ref] = await selectRows(conn, 'SELECT conversation_id FROM ai_drafts WHERE id = ?', [draftId])
  if (!ref) throw new SupportError(404, 'Draft not found.')
  const conv = await lockConversation(conn, Number(ref.conversation_id))
  const [fresh] = await selectRows(conn, 'SELECT * FROM ai_drafts WHERE id = ? FOR UPDATE', [draftId])
  if (!fresh) throw new SupportError(404, 'Draft not found.')
  const [revision] = await selectRows(conn, 'SELECT * FROM ai_draft_revisions WHERE draft_id = ? AND revision = ?', [draftId, Number(fresh.current_revision)])
  return { draft: fresh, conv, revision }
}

function requireReady(draft: Row, conv: Row) {
  if (draft.status !== 'ready') throw new SupportError(409, `This draft is ${String(draft.status)} and can no longer be changed.`)
  // Never send an answer to an earlier question when the student has written since.
  if (Number(draft.trigger_message_id) !== Number(conv.last_student_message_id))
    throw new SupportError(409, 'The student has sent a newer message. Reply to that message instead.')
}

function requireRevision(draft: Row, revision: unknown) {
  if (Number(revision) !== Number(draft.current_revision))
    throw new SupportError(409, 'The draft changed since you opened it. Reload and review the latest version.')
}

export async function editDraft(pool: Pool, actor: AdminActor, draftId: number, input: { body: unknown; revision: unknown }): Promise<number> {
  assertActor(actor, 'support.review_ai')
  const body = messageBody.safeParse(input.body)
  if (!body.success) throw new SupportError(400, 'Check the draft text.', { body: body.error.issues.map((i) => i.message) })
  return inTransaction(pool, async (conn) => {
    const { draft, conv, revision } = await lockDraft(conn, draftId)
    requireReady(draft, conv)
    requireRevision(draft, input.revision)
    if (revision && revision.body === body.data) return Number(draft.current_revision)
    const next = Number(draft.current_revision) + 1
    await conn.query("INSERT INTO ai_draft_revisions (draft_id, revision, body, body_sha256, created_by_kind, created_by) VALUES (?, ?, ?, ?, 'staff', ?)", [
      draftId,
      next,
      body.data,
      sha256(body.data),
      actor.userId,
    ])
    await conn.query('UPDATE ai_drafts SET current_revision = ? WHERE id = ?', [next, draftId])
    await appendChangeLog(conn, {
      entityType: 'ai_draft',
      entityId: draftId,
      action: 'draft_edit',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: null,
      before: { revision: Number(draft.current_revision), bodySha256: revision ? String(revision.body_sha256) : null },
      after: { revision: next, bodySha256: sha256(body.data) },
    })
    return next
  })
}

/** Records approval of one exact revision. Editing afterwards creates a new revision that this approval does not cover. */
export async function approveDraft(pool: Pool, actor: AdminActor, draftId: number, input: { revision: unknown; bodySha256: unknown }): Promise<void> {
  assertActor(actor, 'support.review_ai')
  await inTransaction(pool, async (conn) => {
    const { draft, conv, revision } = await lockDraft(conn, draftId)
    requireReady(draft, conv)
    requireRevision(draft, input.revision)
    if (!revision || revision.body_sha256 !== input.bodySha256) throw new SupportError(409, 'The draft text changed since you reviewed it. Reload and review it again.')
    await recordApproval(conn, actor, draftId, revision)
  })
}

async function recordApproval(conn: PoolConnection, actor: AdminActor, draftId: number, revision: Row) {
  await conn.query("INSERT INTO draft_reviews (draft_id, revision, body_sha256, decision, reviewer_id) VALUES (?, ?, ?, 'approve', ?)", [
    draftId,
    Number(revision.revision),
    String(revision.body_sha256),
    actor.userId,
  ])
  await appendChangeLog(conn, {
    entityType: 'ai_draft',
    entityId: draftId,
    action: 'draft_approve',
    actorId: actor.userId,
    actorRole: actor.role,
    reason: null,
    before: null,
    after: { revision: Number(revision.revision), bodySha256: String(revision.body_sha256) },
  })
}

/** Sends the current revision, which must carry an approval for exactly that revision and text. */
export async function sendApprovedDraft(pool: Pool, actor: AdminActor, draftId: number): Promise<number> {
  assertActor(actor, 'support.review_ai')
  return inTransaction(pool, async (conn) => {
    const { draft, conv, revision } = await lockDraft(conn, draftId)
    requireReady(draft, conv)
    if (!revision) throw new SupportError(409, 'This draft has no text.')
    const [approval] = await selectRows(
      conn,
      "SELECT r.reviewer_id FROM draft_reviews r WHERE r.draft_id = ? AND r.revision = ? AND r.body_sha256 = ? AND r.decision = 'approve' ORDER BY r.id DESC LIMIT 1",
      [draftId, Number(revision.revision), String(revision.body_sha256)],
    )
    if (!approval) throw new SupportError(409, 'The current version of this draft has not been approved.')
    if (conv.student_status !== 'active') throw new SupportError(409, 'This student account is no longer active.')
    return deliverDraft(conn, conv, draftId, String(revision.body), actor)
  })
}

/** "Approve and send" in one step, still pinned to the revision and text the reviewer saw. */
export async function approveAndSendDraft(pool: Pool, actor: AdminActor, draftId: number, input: { revision: unknown; bodySha256: unknown }): Promise<number> {
  assertActor(actor, 'support.review_ai')
  return inTransaction(pool, async (conn) => {
    const { draft, conv, revision } = await lockDraft(conn, draftId)
    requireReady(draft, conv)
    requireRevision(draft, input.revision)
    if (!revision || revision.body_sha256 !== input.bodySha256) throw new SupportError(409, 'The draft text changed since you reviewed it. Reload and review it again.')
    if (conv.student_status !== 'active') throw new SupportError(409, 'This student account is no longer active.')
    await recordApproval(conn, actor, draftId, revision)
    return deliverDraft(conn, conv, draftId, String(revision.body), actor)
  })
}

export async function rejectDraft(pool: Pool, actor: AdminActor, draftId: number, input: { revision: unknown; reason: unknown }): Promise<void> {
  assertActor(actor, 'support.review_ai')
  const reason = reasonText.safeParse(input.reason ?? '')
  if (!reason.success) throw new SupportError(400, 'Give a reason for rejecting the draft.', { reason: reason.error.issues.map((i) => i.message) })
  await inTransaction(pool, async (conn) => {
    const { draft, conv, revision } = await lockDraft(conn, draftId)
    requireReady(draft, conv)
    requireRevision(draft, input.revision)
    await conn.query("INSERT INTO draft_reviews (draft_id, revision, body_sha256, decision, reviewer_id, reason) VALUES (?, ?, ?, 'reject', ?, ?)", [
      draftId,
      Number(draft.current_revision),
      revision ? String(revision.body_sha256) : '0'.repeat(64),
      actor.userId,
      reason.data,
    ])
    await conn.query("UPDATE ai_drafts SET status = 'rejected' WHERE id = ?", [draftId])
    // The question still needs a human answer.
    if (conv.status === 'awaiting_human_review')
      await applyEvent(conn, { id: Number(conv.id), status: conv.status }, { type: 'staff_set', to: 'open' }, { kind: 'staff', id: actor.userId }, 'Derek draft rejected')
    await appendChangeLog(conn, {
      entityType: 'ai_draft',
      entityId: draftId,
      action: 'draft_reject',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: reason.data,
      before: { status: 'ready', revision: Number(draft.current_revision) },
      after: { status: 'rejected' },
    })
  })
}

export interface DraftView {
  id: number
  status: string
  revision: number
  body: string | null
  bodySha256: string | null
  risk: string | null
  riskReasons: string[]
  evidenceRefs: string[]
  provider: string
  model: string | null
  usage: { inputTokens: number | null; outputTokens: number | null; latencyMs: number | null; attempts: number }
  errorCode: string | null
  editedByName: string | null
  approvedForCurrentRevision: boolean
  createdAt: string
  /** The student message this draft answers. */
  answers: { messageId: number; excerpt: string }
  /** For superseded drafts: what came first after the question it answered. */
  supersededBy: 'newer_message' | 'human_reply' | 'other_draft' | null
}

const parseList = (v: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(v ?? '[]'))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function listDrafts(db: Pick<Pool, 'query'>, actor: AdminActor, conversationId: number): Promise<DraftView[]> {
  assertActor(actor, 'support.read')
  const rows = await selectRows(
    db,
    `SELECT d.*, r.body, r.body_sha256, r.created_by_kind, u.name AS edited_by_name, LEFT(t.body, 160) AS trigger_excerpt,
            (SELECT x.author_kind FROM messages x WHERE x.conversation_id = d.conversation_id AND x.id > d.trigger_message_id ORDER BY x.id LIMIT 1) AS next_author,
            EXISTS (SELECT 1 FROM draft_reviews v WHERE v.draft_id = d.id AND v.revision = d.current_revision
                      AND v.body_sha256 = r.body_sha256 AND v.decision = 'approve') AS approved
       FROM ai_drafts d
       LEFT JOIN ai_draft_revisions r ON r.draft_id = d.id AND r.revision = d.current_revision
       LEFT JOIN auth_user u ON u.id = r.created_by
       LEFT JOIN messages t ON t.id = d.trigger_message_id
      WHERE d.conversation_id = ? ORDER BY d.id DESC LIMIT 20`,
    [conversationId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    status: String(r.status),
    revision: Number(r.current_revision),
    body: r.body == null ? null : String(r.body),
    bodySha256: r.body_sha256 == null ? null : String(r.body_sha256),
    risk: r.risk_level == null ? null : String(r.risk_level),
    riskReasons: parseList(r.risk_reasons),
    evidenceRefs: parseList(r.evidence_refs),
    provider: String(r.provider),
    model: r.model == null ? null : String(r.model),
    usage: {
      inputTokens: r.input_tokens == null ? null : Number(r.input_tokens),
      outputTokens: r.output_tokens == null ? null : Number(r.output_tokens),
      latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
      attempts: Number(r.attempts),
    },
    errorCode: r.error_code == null ? null : String(r.error_code),
    editedByName: r.created_by_kind === 'staff' && r.edited_by_name != null ? String(r.edited_by_name) : null,
    approvedForCurrentRevision: Number(r.approved) === 1,
    createdAt: String(r.created_at),
    answers: { messageId: Number(r.trigger_message_id), excerpt: String(r.trigger_excerpt ?? '') },
    supersededBy:
      r.status !== 'superseded' ? null : r.next_author === 'student' ? 'newer_message' : r.next_author === 'staff' ? 'human_reply' : r.next_author === 'derek' ? 'other_draft' : null,
  }))
}

/** Staff "Ask Derek for a draft" on the latest unanswered student message. */
export async function requestDraftForConversation(pool: Pool, actor: AdminActor, conversationId: number, deps: WorkerDeps = {}): Promise<WorkerOutcome> {
  assertActor(actor, 'support.review_ai')
  const status = deps.status ?? getDerekStatus()
  if (status.state !== 'ready') throw new SupportError(503, status.reasons.join(' '))
  const [conv] = await selectRows(pool, 'SELECT last_student_message_id FROM conversations WHERE id = ?', [conversationId])
  if (!conv) throw new SupportError(404, 'Conversation not found.')
  const outcome = await prepareDerekDraft(pool, conversationId, Number(conv.last_student_message_id), { ...deps, status })
  if (outcome.state === 'duplicate') throw new SupportError(409, 'Derek has already drafted (or is drafting) a reply to this message.')
  if (outcome.state === 'stale') throw new SupportError(409, 'The latest message has already been answered.')
  if (outcome.state === 'ineligible')
    throw new SupportError(409, 'This provider only drafts for students with a recorded 18+ confirmation. Please answer this one yourself.')
  if (outcome.state === 'quota') throw new SupportError(429, 'Derek’s daily draft limit for this provider has been reached. Please answer this one yourself.')
  return outcome
}
