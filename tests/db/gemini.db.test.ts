// Gemini through the real Derek worker and database, with an injected fake fetch: no network,
// no key, no cost. Synthetic data only. Run with `pnpm test:db` / `npm run test:db`.
import { randomUUID } from 'node:crypto'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { handleChat } from './handling'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

type AdminActor = import('@/lib/admin/roles').AdminActor
type StudentActor = import('@/lib/student/access').StudentActor
const C = await import('@/lib/support/conversations')
const D = await import('@/lib/derek/drafts')
const { getDerekStatus } = await import('@/lib/derek/config')
const { GeminiProvider } = await import('@/lib/derek/providers/gemini')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')

let server: TestDatabase
let db: Connection
const KEY = 'AIzaSyFAKE-db-test-key-000000000000000'
const ENV = { DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }
const reviewer: AdminActor = { userId: 'u-gem-reviewer', name: 'Gem Reviewer', email: 'gem-reviewer@test.example', role: 'reviewer' }
const pool = () => getAdminPool()
const rid = () => randomUUID()
const status = () => getDerekStatus(ENV)

async function rows<R = RowDataPacket>(sql: string, params: unknown[] = []): Promise<R[]> {
  const [r] = await db.query<RowDataPacket[]>(sql, params)
  return r as R[]
}

let seq = 0
async function student({ adult }: { adult: boolean }): Promise<StudentActor> {
  seq += 1
  const userId = `gem-stu-${seq}-${randomUUID().slice(0, 8)}`
  const name = `Synthetic Gemini Student ${seq}`
  await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(3))', [userId, name, `gem${seq}@test.example`])
  const [res] = await db.query('INSERT INTO student_profiles (user_id, display_name, age_confirmed_at) VALUES (?, ?, ?)', [userId, name, adult ? '2026-10-01 00:00:00' : null])
  return { userId, profileId: Number((res as { insertId: number }).insertId), displayName: name }
}

function geminiReply(text: string, finishReason = 'STOP') {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
      usageMetadata: { promptTokenCount: 640, candidatesTokenCount: 80, thoughtsTokenCount: 16 },
      modelVersion: 'gemini-3.5-flash-lite',
    }),
    { status: 200 },
  )
}

/** A Gemini provider whose fetch is fully under test control. */
function gemini(respond: (init: RequestInit) => Promise<Response> | Response, dailyDraftLimit = 100) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return respond(init)
  }) as unknown as typeof fetch
  return { provider: new GeminiProvider({ apiKey: KEY, dailyDraftLimit, fetchImpl }), calls }
}

const realFetch = globalThis.fetch
beforeAll(async () => {
  globalThis.fetch = (() => {
    throw new Error('A test tried to use the real network.')
  }) as typeof fetch
  server = await startTestDatabase()
  console.info(`[db] gemini suite running on ${server.engine}`)
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  Object.assign(process.env, { DATABASE_URL: server.url })
  for (const k of ['DEREK_AI_ENABLED', 'DEREK_PROVIDER', 'GEMINI_API_KEY', 'DEREK_AUTO_REPLY_CLEARED', 'STUDENT_ACCOUNTS_ENABLED']) delete process.env[k]
  await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(3))', [reviewer.userId, reviewer.name, reviewer.email])
}, 240_000)

afterAll(async () => {
  globalThis.fetch = realFetch
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

describe('Gemini drafts through the worker (fake fetch)', () => {
  it('never contacts Gemini for a student without a recorded 18+ confirmation', async () => {
    const s = await student({ adult: false })
    const q = await C.createConversation(pool(), s, { body: 'What is a foundation year?', clientRequestId: rid() })
    const { provider, calls } = gemini(() => geminiReply('unused'))
    expect(await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: status(), provider })).toEqual({ state: 'ineligible' })
    expect(calls).toHaveLength(0)
    expect(await rows('SELECT id FROM ai_drafts WHERE conversation_id = ?', [q.conversationId])).toHaveLength(0)
    const [conv] = await rows<{ status: string }>('SELECT status FROM conversations WHERE id = ?', [q.conversationId])
    expect(conv.status).toBe('open') // still in the Live Inbox for a person
    await expect(D.requestDraftForConversation(pool(), reviewer, q.conversationId, { status: status(), provider })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/18\+ confirmation/) })
  })

  it('drafts for review with usage metadata and sends only redacted text while automatic replies are not cleared for Gemini', async () => {
    const s = await student({ adult: true })
    const q = await C.createConversation(pool(), s, { body: 'What is a conditional offer? Reach me on asha@example.com or +91 98765 43210.', clientRequestId: rid() })
    // The owner's switch is on, but DEREK_AUTO_REPLY_CLEARED does not name gemini: Gemini only drafts.
    await db.query("UPDATE support_settings SET support_mode = 'offline', auto_reply_enabled = TRUE WHERE id = 1")
    Object.assign(process.env, ENV)
    try {
      const { provider, calls } = gemini(() => geminiReply('A conditional offer means a place is held for you once you meet the remaining conditions, such as final results. Conditions vary by university.'))
      const out = await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: status(), provider })
      expect(out).toMatchObject({ state: 'review', risk: 'low' })
      const sent = JSON.stringify(calls[0].body)
      expect(sent).toContain('[email removed]')
      expect(sent).toContain('[number removed]')
      expect(sent).not.toMatch(/asha@example\.com|98765|Synthetic Gemini Student/)
      expect(await rows("SELECT id FROM messages WHERE conversation_id = ? AND author_kind = 'derek'", [q.conversationId])).toHaveLength(0)
      const [draft] = await D.listDrafts(pool(), reviewer, q.conversationId)
      expect(draft).toMatchObject({ status: 'ready', provider: 'gemini', model: 'gemini-3.5-flash-lite', usage: { inputTokens: 640, outputTokens: 96, attempts: 1 } })

      // Human review and attribution are unchanged.
      await D.approveAndSendDraft(pool(), reviewer, draft.id, { revision: draft.revision, bodySha256: draft.bodySha256 })
      const msgs = (await C.getStudentMessages(pool(), s, q.conversationId)).messages
      expect(msgs.at(-1)).toMatchObject({ authorKind: 'derek', label: 'Replied by Derek · AI assistant · reviewed by Gem Reviewer' })
    } finally {
      for (const k of [...Object.keys(ENV), 'DEREK_AUTO_REPLY_CLEARED']) delete process.env[k]
      await db.query("UPDATE support_settings SET support_mode = 'online', auto_reply_enabled = FALSE WHERE id = 1")
    }
  })

  it('auto-sends a low-risk answer once the owner clears Gemini (D-041), attributed and audited, but not while the team is online', async () => {
    const s = await student({ adult: true })
    const cleared = { ...ENV, DEREK_AUTO_REPLY_CLEARED: 'gemini' }
    await db.query("UPDATE support_settings SET auto_reply_enabled = TRUE WHERE id = 1")
    Object.assign(process.env, cleared)
    try {
      const answer = 'A conditional offer means a place is held for you once you meet the remaining conditions, such as final results. Conditions vary by university.'
      const q = await C.createConversation(pool(), s, { body: 'What is a conditional offer?', clientRequestId: rid() })
      const { provider } = gemini(() => geminiReply(answer))
      const out = await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: getDerekStatus(cleared), provider })
      expect(out).toMatchObject({ state: 'auto_sent' })
      const last = (await C.getStudentMessages(pool(), s, q.conversationId)).messages.at(-1)
      expect(last).toMatchObject({ authorKind: 'derek', label: 'Replied by Derek · AI assistant · automatic reply, not reviewed by a person' })
      expect(last?.body.endsWith(answer)).toBe(true)
      const [audit] = await rows<{ after_data: unknown }>("SELECT after_data FROM data_change_log WHERE entity_type = 'ai_draft' AND action = 'draft_send' ORDER BY id DESC LIMIT 1")
      expect(JSON.stringify(audit.after_data)).toMatch(/"provider":"gemini"/)

      // A team member online: the same kind of question waits for a person.
      await db.query("INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES ('u-gem-dev', 'Dev Gem', 'gem-dev@test.example', 1, UTC_TIMESTAMP(3))")
      await db.query("INSERT INTO admin_members (user_id, role, status, granted_by) VALUES ('u-gem-dev', 'reviewer', 'active', 'cli:test')")
      const q2 = await C.createConversation(pool(), s, { body: 'What is an unconditional offer?', clientRequestId: rid() })
      await handleChat(db, 'u-gem-dev', q2.conversationId)
      const held = await D.prepareDerekDraft(pool(), q2.conversationId, q2.triggerMessageId!, { status: getDerekStatus(cleared), provider: gemini(() => geminiReply(answer)).provider })
      expect(held).toMatchObject({ state: 'review' })
    } finally {
      for (const k of Object.keys(cleared)) delete process.env[k]
      await db.query('DELETE FROM staff_presence')
      await db.query("DELETE FROM admin_members WHERE user_id = 'u-gem-dev'")
      await db.query("UPDATE support_settings SET support_mode = 'online', auto_reply_enabled = FALSE WHERE id = 1")
    }
  })

  it('escalates invented figures to high risk and notifies reviewers', async () => {
    const s = await student({ adult: true })
    const q = await C.createConversation(pool(), s, { body: 'How much does a master’s at Nowhere University cost, and how is it ranked?', clientRequestId: rid() })
    const { provider } = gemini(() => geminiReply('Tuition is around GBP 21,500 a year and it is ranked #57 globally.'))
    expect(await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: status(), provider })).toMatchObject({ state: 'review', risk: 'high' })
    const [draft] = await D.listDrafts(pool(), reviewer, q.conversationId)
    expect(draft.riskReasons.join(' ')).toMatch(/Figures not found in verified evidence: GBP 21,500.*#57/)
    expect(await rows("SELECT id FROM notifications WHERE conversation_id = ? AND kind = 'high_risk'", [q.conversationId])).toHaveLength(1)
  })

  it('keeps the question with a human after repeated provider errors', async () => {
    const s = await student({ adult: true })
    const q = await C.createConversation(pool(), s, { body: 'What documents does an application need?', clientRequestId: rid() })
    const { provider, calls } = gemini(() => new Response('{}', { status: 429 }))
    const out = await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: status(), provider, callOptions: { retryDelayMs: 0 } })
    expect(out).toMatchObject({ state: 'failed', code: 'rate_limited' })
    expect(calls).toHaveLength(2)
    const [draft] = await rows<{ attempts: number; error_code: string }>('SELECT attempts, error_code FROM ai_drafts WHERE conversation_id = ?', [q.conversationId])
    expect(draft).toEqual({ attempts: 2, error_code: 'rate_limited' })
    expect(await rows("SELECT id FROM notifications WHERE conversation_id = ? AND kind = 'ai_failure'", [q.conversationId])).toHaveLength(1)
    await C.staffReply(pool(), reviewer, q.conversationId, { body: 'Here is the list.', clientRequestId: rid() })
  })

  it('with DEREK_MAX_ATTEMPTS=1 the worker sends exactly one request, even when it fails', async () => {
    const s = await student({ adult: true })
    const q = await C.createConversation(pool(), s, { body: 'What is an unconditional offer?', clientRequestId: rid() })
    const { provider, calls } = gemini(() => new Response('{}', { status: 503 }))
    process.env.DEREK_MAX_ATTEMPTS = '1'
    try {
      expect(await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: status(), provider })).toMatchObject({ state: 'failed', code: 'unavailable' })
    } finally {
      delete process.env.DEREK_MAX_ATTEMPTS
    }
    expect(calls).toHaveLength(1)
  })

  it('stops at the daily draft cap without calling Gemini', async () => {
    const s = await student({ adult: true })
    const [[used]] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM ai_drafts WHERE provider = 'gemini' AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY")
    const q = await C.createConversation(pool(), s, { body: 'What is a personal statement?', clientRequestId: rid() })
    const { provider, calls } = gemini(() => geminiReply('unused'), Number(used.n))
    expect(await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: status(), provider })).toEqual({ state: 'quota' })
    expect(calls).toHaveLength(0)
    await expect(D.requestDraftForConversation(pool(), reviewer, q.conversationId, { status: status(), provider })).rejects.toMatchObject({ status: 429 })
  })

  it('claims each question once and loses the race to a human reply', async () => {
    const s = await student({ adult: true })
    const a = await C.createConversation(pool(), s, { body: 'What is a credit transfer?', clientRequestId: rid() })
    const once = gemini(() => geminiReply('A credit transfer means…'))
    const results = await Promise.all([
      D.prepareDerekDraft(pool(), a.conversationId, a.triggerMessageId!, { status: status(), provider: once.provider }),
      D.prepareDerekDraft(pool(), a.conversationId, a.triggerMessageId!, { status: status(), provider: once.provider }),
    ])
    expect(results.map((r) => r.state).sort()).toEqual(['duplicate', 'review'])
    expect(once.calls).toHaveLength(1)

    const b = await C.createConversation(pool(), s, { body: 'What is deferral?', clientRequestId: rid() })
    const racing = gemini(async () => {
      await C.staffReply(pool(), reviewer, b.conversationId, { body: 'A person answered first.', clientRequestId: rid() })
      return geminiReply('Deferral means…')
    })
    expect((await D.prepareDerekDraft(pool(), b.conversationId, b.triggerMessageId!, { status: status(), provider: racing.provider })).state).toBe('superseded')
    expect(await rows("SELECT author_kind FROM messages WHERE conversation_id = ? AND author_kind <> 'student'", [b.conversationId])).toEqual([{ author_kind: 'staff' }])
  })
})
