import type { Pool, PoolConnection } from 'mysql2/promise'
import { appendChangeLog } from '@/lib/admin/audit'
import type { AdminActor } from '@/lib/admin/roles'
import { applyEvent, lockConversation } from '@/lib/support/conversations'
import { assertActor, inTransaction, isDuplicate, selectRows, sha256, SupportError, type Row } from '@/lib/support/db'
import { createNotification } from '@/lib/support/notifications'
import { getTeamPresence } from '@/lib/support/presence'
import { autoReplyActive, getSupportSettings } from '@/lib/support/settings'
import { TransitionError } from '@/lib/support/state'
import { messageBody, reasonText } from '@/lib/support/validation'
import { AUTO_REPLY_LIMITS, decideAutoReply, keepsQualifiers, TEAM_ONLINE_HOLD } from './auto-reply'
import { createProvider, derekDailyTokenLimit, derekMaxAttempts, getDerekStatus, type DerekStatus } from './config'
import { loadEvidence } from './evidence'
import { analyseQuestion, COMPARISON_TARGET_CHARS, studentPlanFromSubject } from './guidance'
import { DEREK_INSTRUCTIONS, type AiProvider, type DraftRequest, type EvidenceItem } from './provider'
import { callProvider, MAX_ATTEMPTS, type CallOutcome } from './runtime'
import { assessDraft, assessQuestion, combineRisk, redactPersonalData } from './safeguards'
import { FREE_TIER_HOLD_CODE, screenForFreeTier } from './free-tier'
import { PRIVACY_NOTICE_VERSION } from '@/lib/student/onboarding'
import { classifyMessage, GREETING_REPLY, isSmallTalk, OFF_TOPIC_REPLY, RULES_PROVIDER_ID, scopeRisk, THANKS_REPLY } from './scope'

const RULES_MODEL = 'derek-rules-1'
import { styleIssues, tidyDraft } from './style'

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
  | { state: 'taken_over' } // a team member is handling this conversation; Derek stays out
  | { state: 'deferred' } // small talk after an unanswered message: that message is answered instead
  | { state: 'superseded'; draftId: number }
  | { state: 'failed'; draftId: number; code: string }
  | { state: 'review'; draftId: number; risk: string }
  | { state: 'auto_sent'; draftId: number; messageId: number }

export interface WorkerDeps {
  status?: DerekStatus
  provider?: AiProvider | null
  callOptions?: Parameters<typeof callProvider>[2]
  loadEvidence?: (db: Pool, question: string) => Promise<EvidenceItem[]>
  /** A team member asked for this draft, so it is prepared even in a taken-over conversation. */
  manual?: boolean
}

const HISTORY_TURNS = 6

export async function prepareDerekDraft(pool: Pool, conversationId: number, triggerMessageId: number, deps: WorkerDeps = {}): Promise<WorkerOutcome> {
  const status = deps.status ?? getDerekStatus()
  const provider = deps.provider === undefined ? createProvider(status) : deps.provider
  if (status.state !== 'ready' || !provider) return { state: 'disabled' }
  // Gemini free tier: Google may keep and read what it gets, so send as little as possible (lib/derek/free-tier.ts).
  const freeTier = status.freeTier === true

  // 1. Claim the question. The UNIQUE key on trigger_message_id makes this the only worker.
  const claim = await inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    const [trigger] = await selectRows(conn, "SELECT id, body FROM messages WHERE id = ? AND conversation_id = ? AND author_kind = 'student'", [triggerMessageId, conversationId])
    if (!trigger || conv.status === 'resolved' || conv.student_status !== 'active') return null
    const [answered] = await selectRows(conn, "SELECT id FROM messages WHERE conversation_id = ? AND id > ? AND author_kind <> 'student' LIMIT 1", [conversationId, triggerMessageId])
    if (answered) return null
    if (conv.ai_paused_by != null && !deps.manual) return 'taken_over' as const

    // Every student message since the last reply. Derek answers all of them, never only the latest,
    // so an earlier question cannot be dropped by a later, easier one.
    const pending = await selectRows(
      conn,
      `SELECT id, body FROM messages WHERE conversation_id = ? AND author_kind = 'student' AND id <= ?
          AND id > COALESCE((SELECT MAX(r.id) FROM messages r WHERE r.conversation_id = ? AND r.author_kind <> 'student' AND r.id < ?), 0)
        ORDER BY id`,
      [conversationId, triggerMessageId, conversationId, triggerMessageId],
    )
    const own = classifyMessage(String(trigger.body))
    // "thanks" or "hi" while an earlier message is still unanswered: no reply of its own. The
    // earlier message's draft (or a person) answers; a quick reply here would hide that question.
    if (isSmallTalk(own) && pending.length > 1 && !deps.manual) return 'deferred' as const
    const asks = pending.map((m) => classifyMessage(String(m.body))).filter((c) => !isSmallTalk(c))
    const classification = asks.length > 1 ? classifyMessage(asks.map((c) => c.question).join('\n\n')) : (asks[0] ?? own)
    const firstPendingId = Number(pending[0]?.id ?? triggerMessageId)

    // Scope guard, before any provider is contacted (lib/derek/scope.ts).
    // A greeting or thanks gets a short reply of LockIn's own, never a model-written essay.
    const fixed = { off_topic: OFF_TOPIC_REPLY, greeting: GREETING_REPLY, thanks: THANKS_REPLY, in_scope: null, unclear: null }[classification.scope]
    if (fixed) {
      const [res] = await conn.query("INSERT INTO ai_drafts (conversation_id, trigger_message_id, status, provider, model) VALUES (?, ?, 'generating', ?, ?)", [
        conversationId,
        triggerMessageId,
        RULES_PROVIDER_ID,
        RULES_MODEL,
      ]).catch((e) => {
        if (isDuplicate(e)) return ['duplicate'] as const
        throw e
      })
      if (res === 'duplicate') return 'duplicate' as const
      return { draftId: Number((res as { insertId: number }).insertId), question: classification.question, classification, fixed, firstPendingId, plan: studentPlanFromSubject(String(conv.subject ?? '')), identity: undefined }
    }

    // 18+ gate, for every provider whatever its adapter declares: no recorded 18+ confirmation, no
    // provider call (Gemini API terms; Owner decision 6 Nov 2026). Checked here, inside the claim, because
    // every provider request goes through it. The question stays in the Live Inbox for a person.
    if (conv.student_age_confirmed_at == null) return 'ineligible' as const
    // Free tier: the student must have accepted the current privacy notice, which says what Google may do with it.
    if (freeTier && conv.student_privacy_version !== PRIVACY_NOTICE_VERSION) return 'ineligible' as const
    const identity = freeTier
      ? (await conn.query<Row[]>('SELECT s.display_name AS displayName, u.email AS email FROM student_profiles s JOIN auth_user u ON u.id = s.user_id WHERE s.id = ?', [conv.student_profile_id]))[0][0]
      : undefined
    // Serialise claims on the settings row so concurrent workers cannot overshoot the caps.
    await conn.query('SELECT id FROM support_settings WHERE id = 1 FOR UPDATE')
    const [[used]] = await conn.query<Row[]>(
      `SELECT COALESCE(SUM(provider = ?), 0) AS drafts, COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
         FROM ai_drafts WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY`,
      [provider.id],
    )
    if (provider.policy?.external && Number(used.drafts) >= provider.policy.dailyDraftLimit) return 'quota' as const
    // Spend cap for every provider. shortcut: drafts still generating are not counted yet, so the
    // overshoot is bounded by the drafts in flight; fine at LockIn's volume.
    if (Number(used.tokens) >= derekDailyTokenLimit()) return 'quota' as const
    try {
      const [res] = await conn.query("INSERT INTO ai_drafts (conversation_id, trigger_message_id, status, provider, model) VALUES (?, ?, 'generating', ?, ?)", [
        conversationId,
        triggerMessageId,
        provider.id,
        provider.model,
      ])
      return { draftId: Number((res as { insertId: number }).insertId), question: classification.question, classification, fixed: null, firstPendingId, plan: studentPlanFromSubject(String(conv.subject ?? '')), identity }
    } catch (e) {
      if (isDuplicate(e)) return 'duplicate' as const
      throw e
    }
  })
  if (claim === 'duplicate') return { state: 'duplicate' }
  if (claim === 'ineligible') return { state: 'ineligible' }
  if (claim === 'quota') return { state: 'quota' }
  if (claim === 'taken_over') return { state: 'taken_over' }
  if (claim === 'deferred') return { state: 'deferred' }
  if (!claim) return { state: 'stale' }

  // 2. Build the request from redacted text and verified evidence only. No lock is held during
  //    the provider call. A fixed reply needs neither evidence nor a provider.
  let evidence: EvidenceItem[] = []
  let outcome: CallOutcome
  let general = false
  let held: string | null = null
  if (claim.fixed) outcome = { ok: true, result: { text: claim.fixed, model: RULES_MODEL }, attempts: 0, latencyMs: 0 }
  else if (freeTier && (held = screenForFreeTier(claim.question, { displayName: claim.identity?.displayName == null ? null : String(claim.identity.displayName), email: claim.identity?.email == null ? null : String(claim.identity.email) }))) {
    // Nothing is sent to Google: the question stays in the Live Inbox for a person (the failure path below tells the team).
    outcome = { ok: false, code: FREE_TIER_HOLD_CODE, attempts: 0, latencyMs: 0 }
  } else {
    const historyRows = freeTier ? [] : await selectRows(
      pool,
      'SELECT author_kind, body FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
      [conversationId, claim.firstPendingId, HISTORY_TURNS],
    )
    const question = redactPersonalData(claim.question)
    const history = historyRows.reverse().map((r) => ({ role: r.author_kind === 'student' ? ('student' as const) : ('team' as const), text: redactPersonalData(String(r.body)) }))
    // The plan from the first-question form (destination and course only, never the Instagram
    // handle) counts as something the student already told Derek.
    const earlier = [freeTier ? '' : (claim.plan ?? ''), ...history.filter((h) => h.role === 'student').map((h) => h.text)].join('\n')
    // "What about Italy?" looks up evidence with the earlier question's context too.
    const lookup = analyseQuestion(question, [], earlier).isFollowUp ? `${earlier}\n${claim.question}` : claim.question
    evidence = await (deps.loadEvidence ?? loadEvidence)(pool, lookup)
    const analysed = analyseQuestion(question, evidence, earlier, history.filter((h) => h.role === 'team').at(-1)?.text)
    const guidance = claim.plan && !freeTier
      ? { ...analysed, note: `${analysed.note} The student told LockIn before asking: "${redactPersonalData(claim.plan)}" Use this and do not ask for it again.` }
      : analysed
    general = guidance.kind !== 'specific_fact'
    const request = { question, history, evidence, instructions: DEREK_INSTRUCTIONS, guidance }
    const options = deps.callOptions ?? { maxAttempts: derekMaxAttempts() }
    outcome = await callProvider(provider, request, options)
    // Only spend the rewrite request when an automatic reply could really be sent (switch, clearance, team offline).
    const autoReplyPossible = async () => autoReplyActive(await getSupportSettings(pool), status) && (await getTeamPresence(pool)).state === 'offline'
    outcome = await shortenIfTooLong(provider, request, options, outcome, autoReplyPossible)
  }

  // 3. Record the result under the conversation lock.
  return inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    const [draft] = await selectRows(conn, 'SELECT * FROM ai_drafts WHERE id = ? FOR UPDATE', [claim.draftId])
    if (!draft || draft.status !== 'generating') return { state: 'superseded', draftId: claim.draftId }
    const [answered] = await selectRows(conn, "SELECT id FROM messages WHERE conversation_id = ? AND id > ? AND author_kind <> 'student' LIMIT 1", [conversationId, triggerMessageId])
    // A newer question overtakes this draft (its own draft answers both); small talk does not.
    const newer = await selectRows(conn, "SELECT body FROM messages WHERE conversation_id = ? AND id > ? AND author_kind = 'student'", [conversationId, triggerMessageId])
    if (answered || newer.some((m) => !isSmallTalk(classifyMessage(String(m.body))))) {
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

    // LockIn's fixed wording is sent exactly as written; only model text is tidied.
    const text = messageBody.safeParse(claim.fixed ?? tidyDraft(outcome.result.text))
    if (!text.success) {
      await conn.query("UPDATE ai_drafts SET status = 'failed', error_code = 'invalid_response', attempts = ? WHERE id = ?", [outcome.attempts, claim.draftId])
      await applyEvent(conn, { id: conversationId, status: conv.status }, { type: 'ai_failed' }, { kind: 'system', id: null }, 'Derek invalid_response').catch((e) => {
        if (!(e instanceof TransitionError)) throw e
      })
      return { state: 'failed', draftId: claim.draftId, code: 'invalid_response' }
    }
    // A fixed reply states no facts, so only the question's high-risk topics carry over to it.
    const asked = assessQuestion(claim.question, evidence, { general })
    const questionRisk = claim.fixed && asked.level !== 'high' ? { level: 'low' as const, reasons: [] } : asked
    const risk = combineRisk(assessDraft(text.data, questionRisk, evidence, { modelUncertain: outcome.result.uncertain }), scopeRisk(claim.classification))
    // Editorial findings are for the reviewer (and stop automatic sending); they do not raise the risk level.
    if (!claim.fixed) risk.reasons.push(...styleIssues(text.data).map((s) => `Style: ${s}`))
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

    // Automatic reply: every gate is re-read now, inside the lock, not when the job started. The
    // newer-message and human-reply checks above already returned 'superseded'.
    const decision = await decideAutoReply(conn, {
      settings: await getSupportSettings(conn),
      status: getDerekStatus(),
      provider,
      builtIn: claim.fixed != null,
      conv,
      risk: risk.level,
      text: text.data,
      evidence,
    })
    if (decision.send) {
      const messageId = await deliverDraft(conn, conv, claim.draftId, text.data, null, {
        provider: claim.fixed ? RULES_PROVIDER_ID : provider.id,
        model: outcome.result.model.slice(0, 120),
      })
      return { state: 'auto_sent', draftId: claim.draftId, messageId }
    }
    const held = decision.heldReason
    if (held) await conn.query('UPDATE ai_drafts SET hold_reason = ? WHERE id = ?', [held.slice(0, 300), claim.draftId])

    try {
      await applyEvent(
        conn,
        { id: conversationId, status: conv.status },
        { type: 'draft_needs_review' },
        { kind: 'derek', id: null },
        held ? `Automatic reply held: ${held}`.slice(0, 300) : `Draft risk: ${risk.level}`,
      )
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e
    }
    await createNotification(conn, {
      audience: 'staff_support',
      kind: risk.level === 'low' ? 'draft_ready' : 'high_risk',
      conversationId,
      title: held
        ? `Derek’s automatic reply in conversation #${conversationId} was held (${held}) — review before sending`
        : risk.level === 'low'
          ? `Derek drafted a reply for conversation #${conversationId} — review before sending`
          : `${risk.level === 'high' ? 'High-risk' : 'Uncertain'} Derek draft in conversation #${conversationId} — human review required`,
      targetPath: `/admin/inbox/${conversationId}`,
    })
    return { state: 'review', draftId: claim.draftId, risk: risk.level }
  })
}

/**
 * One shortening attempt for a model answer that is too long to send automatically (the 900-character
 * limit stays as it is). It is the draft's last provider attempt, so it never exceeds the attempt
 * budget (DEREK_MAX_ATTEMPTS), and it is only made when an automatic reply could actually be sent.
 * The shorter text replaces the original only if it fits and keeps every caveat the original had;
 * either way the result then goes through every usual check, and a long answer stays held.
 */
/** The one rewrite request for an answer over the automatic-send limit. */
export function shorteningInstruction(original: string): string {
  const { min, max } = COMPARISON_TARGET_CHARS
  return [
    `REWRITE SHORTER: your previous answer (below) is ${original.length} characters; automatic replies are limited to ${AUTO_REPLY_LIMITS.maxChars}.`,
    `Rewrite it in ${min} to ${max} characters: at most four short bullets, each starting with a label, then one short line that details vary by university and are on each official course page.`,
    'No introduction and no other conclusion or summary.',
    'Keep every statement of uncertainty and of what LockIn has not verified.',
    'Do not add any fact, figure, name, fee, ranking, deadline or admission requirement that is not in the previous answer or in EVIDENCE; drop a general claim you cannot support instead of keeping it.',
    `Previous answer: """${original}"""`,
  ].join(' ')
}

async function shortenIfTooLong(
  provider: AiProvider,
  request: DraftRequest,
  options: NonNullable<WorkerDeps['callOptions']>,
  outcome: CallOutcome,
  autoReplyPossible: () => Promise<boolean>,
): Promise<CallOutcome> {
  if (!outcome.ok) return outcome
  const original = tidyDraft(outcome.result.text)
  const budget = options.maxAttempts ?? MAX_ATTEMPTS
  if (!request.guidance || original.length <= AUTO_REPLY_LIMITS.maxChars || outcome.attempts >= budget || !(await autoReplyPossible())) return outcome
  const guidance = { ...request.guidance, note: `${request.guidance.note} ${shorteningInstruction(original)}` }
  const shorter = await callProvider(provider, { ...request, guidance }, { ...options, maxAttempts: 1 })
  const spent = { attempts: outcome.attempts + shorter.attempts, latencyMs: outcome.latencyMs + shorter.latencyMs }
  const usage = {
    inputTokens: (outcome.result.usage?.inputTokens ?? 0) + (shorter.ok ? (shorter.result.usage?.inputTokens ?? 0) : 0),
    outputTokens: (outcome.result.usage?.outputTokens ?? 0) + (shorter.ok ? (shorter.result.usage?.outputTokens ?? 0) : 0),
  }
  const text = shorter.ok ? tidyDraft(shorter.result.text) : ''
  if (shorter.ok && text.length <= AUTO_REPLY_LIMITS.maxChars && keepsQualifiers(original, text))
    return { ok: true, result: { ...shorter.result, uncertain: outcome.result.uncertain || shorter.result.uncertain, usage }, ...spent }
  return { ...outcome, result: { ...outcome.result, usage }, ...spent } // keep the original: it stays held for its length
}

/** Shown once, at the start of Derek's first automatic answer since a person (or nobody) last replied. */
export function handoffNoticeText(staffFirstName: string | null): string {
  return staffFirstName
    ? `${staffFirstName} has disconnected, so Derek is taking over for now. I'll help with questions I can answer reliably, and the LockIn team can follow up when available.`
    : 'The LockIn team is offline right now, so Derek, LockIn’s AI assistant, is answering. I’ll help with questions I can answer reliably, and the team can follow up when available.'
}

async function handoffNotice(conn: PoolConnection, conversationId: number): Promise<string | null> {
  const [last] = await selectRows(conn, "SELECT author_kind, reviewed_by FROM messages WHERE conversation_id = ? AND author_kind <> 'student' ORDER BY id DESC LIMIT 1", [conversationId])
  if (last && last.author_kind === 'derek' && last.reviewed_by == null) return null // Derek is already answering
  const [staff] = await selectRows(
    conn,
    "SELECT u.name FROM messages m JOIN auth_user u ON u.id = m.author_user_id WHERE m.conversation_id = ? AND m.author_kind = 'staff' ORDER BY m.id DESC LIMIT 1",
    [conversationId],
  )
  return handoffNoticeText(staff ? String(staff.name).trim().split(/\s+/)[0] || null : null)
}

export type HandoffOutcome = { state: 'none' } | { state: 'sent'; draftId: number; messageId: number }

/**
 * The team went offline while a question was waiting for them: send Derek's prepared answer now,
 * if it is still safe. Called when the student's chat checks in (no background job needed), so it
 * runs again and again; the conversation lock, the draft's status and messages.draft_id UNIQUE make
 * it send at most once. Everything is re-checked inside the lock: takeover, newer replies or
 * questions, risk, provider clearance, the kill switch, caps and the team still being offline.
 */
export async function handOffToDerek(pool: Pool, conversationId: number, deps: { status?: DerekStatus } = {}): Promise<HandoffOutcome> {
  const status = deps.status ?? getDerekStatus()
  const none = { state: 'none' } as const
  if (status.state !== 'ready') return none
  return inTransaction(pool, async (conn) => {
    const conv = await lockConversation(conn, conversationId)
    // Only a conversation waiting for the team, that no person has taken over.
    if (conv.status !== 'awaiting_human_review' || conv.ai_paused_by != null) return none
    const [draft] = await selectRows(conn, "SELECT * FROM ai_drafts WHERE conversation_id = ? AND status = 'ready' ORDER BY id DESC LIMIT 1 FOR UPDATE", [conversationId])
    // Held only because the team was online, low risk, and not edited by a person.
    if (!draft || draft.hold_reason !== TEAM_ONLINE_HOLD || draft.risk_level !== 'low' || Number(draft.current_revision) !== 1) return none
    const trigger = Number(draft.trigger_message_id)
    const later = await selectRows(conn, 'SELECT author_kind, body FROM messages WHERE conversation_id = ? AND id > ?', [conversationId, trigger])
    if (later.some((m) => m.author_kind !== 'student' || !isSmallTalk(classifyMessage(String(m.body))))) return none
    // Another question still waiting for a person (held for risk, or failed) keeps the conversation with the team.
    const [other] = await selectRows(
      conn,
      `SELECT d.id FROM ai_drafts d WHERE d.conversation_id = ? AND d.id <> ? AND d.status IN ('ready', 'failed')
          AND d.trigger_message_id > COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.conversation_id = ? AND m.author_kind <> 'student'), 0)`,
      [conversationId, Number(draft.id), conversationId],
    )
    if (other) return none
    const [revision] = await selectRows(conn, 'SELECT body FROM ai_draft_revisions WHERE draft_id = ? AND revision = 1', [Number(draft.id)])
    if (!revision) return none
    const builtIn = draft.provider === RULES_PROVIDER_ID
    const provider = builtIn ? null : createProvider(status)
    if (!builtIn && (!provider || provider.id !== draft.provider)) return none
    const decision = await decideAutoReply(conn, {
      settings: await getSupportSettings(conn),
      status,
      provider: provider ?? ({ id: RULES_PROVIDER_ID, model: RULES_MODEL } as AiProvider),
      builtIn,
      conv,
      risk: 'low',
      text: String(revision.body),
      evidence: [],
      handoff: true,
    })
    if (!decision.send) return none
    const messageId = await deliverDraft(conn, conv, Number(draft.id), String(revision.body), null, { provider: String(draft.provider), model: String(draft.model) })
    return { state: 'sent', draftId: Number(draft.id), messageId }
  })
}

/** Inserts the Derek message for a draft. Caller holds the conversation lock. */
async function deliverDraft(
  conn: PoolConnection,
  conv: Row,
  draftId: number,
  body: string,
  reviewer: AdminActor | null,
  automatic?: { provider: string; model: string },
): Promise<number> {
  const conversationId = Number(conv.id)
  // Derek's first unreviewed answer after a person (or nobody) last replied says that he is taking over.
  if (!reviewer) {
    const notice = await handoffNotice(conn, conversationId)
    if (notice) body = `${notice}\n\n${body}`
  }
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
    reason: reviewer ? null : 'Automatic reply (not reviewed by a person)',
    before: { conversationStatus: conv.status },
    after: { conversationId, conversationStatus: to, messageId, bodySha256: sha256(body), reviewedBy: reviewer?.userId ?? null, ...(automatic ?? {}) },
  })
  await createNotification(conn, {
    audience: 'user',
    recipientUserId: String(conv.student_user_id),
    kind: 'staff_reply',
    conversationId,
    title: 'Derek replied to your question',
    targetPath: `/chat?c=${conversationId}`,
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
  /** Why Auto Mode did not send this draft, if it was held. Staff only. */
  holdReason: string | null
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
    holdReason: r.hold_reason == null ? null : String(r.hold_reason),
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
  const outcome = await prepareDerekDraft(pool, conversationId, Number(conv.last_student_message_id), { ...deps, status, manual: true })
  if (outcome.state === 'duplicate') throw new SupportError(409, 'Derek has already drafted (or is drafting) a reply to this message.')
  if (outcome.state === 'stale') throw new SupportError(409, 'The latest message has already been answered.')
  if (outcome.state === 'ineligible')
    throw new SupportError(409, 'Derek only drafts for students with a recorded 18+ confirmation. Please answer this one yourself.')
  if (outcome.state === 'quota') throw new SupportError(429, 'Derek’s daily draft limit for this provider has been reached. Please answer this one yourself.')
  return outcome
}
