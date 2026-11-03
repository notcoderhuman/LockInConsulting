// LIVE Gemini smoke test: real API, synthetic data only, throwaway database. Skipped unless run
// deliberately with `npm run test:gemini-live` and GEMINI_API_KEY set in the shell (see
// docs/ENVIRONMENT.md). At most 5 requests reach Google (DEREK_MAX_ATTEMPTS=1, except the comparison:
// its answer plus at most one shortening rewrite).
// Every title starts with a tag (config, greeting, ordinary, comparison, visa, handoff) so one test
// can run alone with -t <tag>; tests/gemini-live-runner.test.ts keeps that true.
// The key is never printed; only states, token counts and short excerpts of Derek's answers are.
import { randomUUID } from 'node:crypto'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

const LIVE = process.env.GEMINI_LIVE_SMOKE === '1' && Boolean(process.env.GEMINI_API_KEY?.trim())

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const C = await import('@/lib/support/conversations')
const S = await import('@/lib/support/settings')
const D = await import('@/lib/derek/drafts')
const { getDerekStatus, createProvider } = await import('@/lib/derek/config')
const { GREETING_REPLY } = await import('@/lib/derek/scope')
const { unsupportedFigures } = await import('@/lib/derek/safeguards')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
type AdminActor = import('@/lib/admin/roles').AdminActor
type StudentActor = import('@/lib/student/access').StudentActor

const owner: AdminActor = { userId: 'live-owner', name: 'Live Owner', email: 'live-owner@test.example', role: 'owner' }
const dev: AdminActor = { userId: 'live-dev', name: 'Dev Live', email: 'live-dev@test.example', role: 'reviewer' }

let server: TestDatabase
let db: Connection
const pool = () => getAdminPool()
const rows = async <R = RowDataPacket>(sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0] as R[]
const excerpt = (s: string) => s.replace(/\s+/g, ' ').slice(0, 160)
let requests = 0

async function makeStudent(): Promise<StudentActor> {
  const userId = `live-stu-${randomUUID().slice(0, 8)}`
  await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3))', [userId, 'Synthetic Student', `${userId}@test.example`])
  const [res] = await db.query('INSERT INTO student_profiles (user_id, display_name, age_confirmed_at) VALUES (?, ?, UTC_TIMESTAMP(3))', [userId, 'Synthetic Student'])
  return { userId, profileId: Number((res as { insertId: number }).insertId), displayName: 'Synthetic Student' }
}
const ask = (s: StudentActor, body: string, subject?: string) => C.createConversation(pool(), s, { body, subject, clientRequestId: randomUUID() })
const run = (q: { conversationId: number; triggerMessageId: number | null }) => D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!)
const lastDraft = async (conversationId: number) =>
  (
    await rows<{ status: string; risk_level: string; hold_reason: string | null; risk_reasons: unknown; input_tokens: number; output_tokens: number; latency_ms: number; body: string | null }>(
      `SELECT d.status, d.risk_level, d.hold_reason, d.risk_reasons, d.input_tokens, d.output_tokens, d.latency_ms, r.body
         FROM ai_drafts d LEFT JOIN ai_draft_revisions r ON r.draft_id = d.id AND r.revision = 1
        WHERE d.conversation_id = ? ORDER BY d.id DESC LIMIT 1`,
      [conversationId],
    )
  )[0]

describe.skipIf(!LIVE)('LIVE Gemini smoke test (synthetic data)', () => {
  beforeAll(async () => {
    server = await startTestDatabase()
    db = await connect(server.url)
    await migrate(db, await loadMigrations())
    Object.assign(process.env, {
      DATABASE_URL: server.url,
      BETTER_AUTH_SECRET: 'live-smoke-'.padEnd(48, 'x'),
      BETTER_AUTH_URL: 'http://localhost:3000',
      DEREK_AI_ENABLED: 'true',
      DEREK_PROVIDER: 'gemini',
      DEREK_AUTO_REPLY_CLEARED: 'gemini',
      DEREK_MAX_ATTEMPTS: '1',
      DEREK_GEMINI_DAILY_DRAFT_LIMIT: '6',
    })
    for (const a of [owner, dev]) await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3))', [a.userId, a.name, a.email])
    await db.query("INSERT INTO admin_members (user_id, role, status, granted_by) VALUES (?, 'reviewer', 'active', 'live-smoke')", [dev.userId])
    await S.updateSupportSettings(pool(), owner, { autoReplyEnabled: true })
    // Count requests to Google without ever reading or printing headers (the key travels in one).
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).startsWith('https://generativelanguage.googleapis.com/')) requests += 1
      return realFetch(input, init)
    })
  }, 240_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    console.info(`[live] requests sent to Gemini: ${requests}`)
    await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
    await db?.end()
    await server?.stop()
  })

  it('config: is configured for real Gemini with automatic replies cleared', () => {
    const status = getDerekStatus()
    expect(status).toMatchObject({ state: 'ready', providerId: 'gemini', autoReply: { permitted: true } })
    expect(createProvider(status)?.model).toBe('gemini-3.5-flash-lite')
  })

  it('greeting: answers "hi" with LockIn’s greeting, without calling Gemini', async () => {
    const before = requests
    const q = await ask(await makeStudent(), 'hi')
    expect(await run(q)).toMatchObject({ state: 'auto_sent' })
    expect((await rows<{ body: string }>("SELECT body FROM messages WHERE conversation_id = ? AND author_kind = 'derek'", [q.conversationId]))[0].body).toContain(GREETING_REPLY)
    expect(requests).toBe(before)
  })

  it('ordinary: answers an ordinary question with a real, relevant Gemini reply, attributed, notified and audited', async () => {
    const s = await makeStudent()
    const q = await ask(s, 'What is a statement of purpose and what should it include?', 'Germany · MSc Computer Science · Instagram @synthetic.handle')
    const out = await run(q)
    const d = await lastDraft(q.conversationId)
    console.info(`[live] SOP → ${out.state}; risk ${d.risk_level}; hold ${d.hold_reason ?? '-'}; ${d.input_tokens}/${d.output_tokens} tokens; ${d.latency_ms} ms; "${excerpt(d.body ?? '')}"`)
    expect(['auto_sent', 'review']).toContain(out.state) // a style or quality hold is a valid, safe outcome
    expect(d.body ?? '').toMatch(/statement of purpose|SOP|goals|motivation/i)
    expect(unsupportedFigures(d.body ?? '', [])).toEqual([])
    if (out.state === 'auto_sent') {
      const view = await C.getStudentMessages(pool(), s, q.conversationId)
      expect(view.messages.at(-1)?.label).toBe('Replied by Derek · AI assistant · automatic reply, not reviewed by a person')
      expect(await rows("SELECT id FROM notifications WHERE recipient_user_id = ? AND audience = 'user'", [s.userId])).toHaveLength(1)
      const [audit] = await rows<{ after_data: unknown }>("SELECT after_data FROM data_change_log WHERE entity_type = 'ai_draft' AND action = 'draft_send' ORDER BY id DESC LIMIT 1")
      expect(JSON.stringify(audit.after_data)).toMatch(/"provider":"gemini"/)
    }
  })

  it('comparison: compares two countries concisely, shortening once if needed, sending only if every check passes', async () => {
    // This test alone allows two attempts: the answer, plus one rewrite if it is over 900 characters.
    process.env.DEREK_MAX_ATTEMPTS = '2'
    try {
      const before = requests
      const q = await ask(await makeStudent(), 'Compare computer science master’s programmes in Germany and Italy.')
      const out = await run(q)
      const d = await lastDraft(q.conversationId)
      const body = d.body ?? ''
      const sent = requests - before
      // Fixed internal labels only (never student text or the key): why it was held, if it was.
      console.info(
        `[live] comparison → ${out.state}; risk ${d.risk_level}; hold ${d.hold_reason ?? '-'}; reasons ${JSON.stringify(d.risk_reasons)}; final ${body.length} chars; Gemini requests ${sent}; ${d.output_tokens} output tokens in total`,
      )
      console.info(`[live] comparison text: "${body.replace(/\s+/g, ' ')}"`)
      expect(sent).toBeGreaterThanOrEqual(1)
      expect(sent).toBeLessThanOrEqual(2)
      expect(unsupportedFigures(body, [])).toEqual([]) // no invented fees, rankings or dates
      // Intended behaviour: a low-risk answer within the limit is sent; anything else is held with its reason.
      if (d.risk_level === 'low' && body.length <= 900 && !d.hold_reason) expect(out.state).toBe('auto_sent')
      else expect(out.state).toBe('review')
      if (body.length > 900) expect(d.hold_reason).toBe('longer than 900 characters')
    } finally {
      process.env.DEREK_MAX_ATTEMPTS = '1'
    }
  })

  it('visa: escalates a visa question to a person', async () => {
    const q = await ask(await makeStudent(), 'My student visa was refused, what should I do now?')
    const out = await run(q)
    console.info(`[live] visa → ${out.state}`)
    expect(out).toMatchObject({ state: 'review', risk: 'high' })
    expect(await rows("SELECT id FROM messages WHERE conversation_id = ? AND author_kind = 'derek'", [q.conversationId])).toHaveLength(0)
  })

  it('handoff: stays silent after a human takeover, and hands over once (no duplicates) when Dev goes offline', async () => {
    const s = await makeStudent()
    const taken = await ask(s, 'What is a conditional offer?')
    await C.takeOverConversation(pool(), dev, taken.conversationId)
    const before = requests
    expect(await run(taken)).toEqual({ state: 'taken_over' })
    expect(requests).toBe(before)

    await db.query('INSERT INTO staff_presence (user_id, last_seen_at) VALUES (?, UTC_TIMESTAMP(3))', [dev.userId])
    const q = await ask(s, 'What is an unconditional offer?')
    const held = await run(q)
    console.info(`[live] while Dev online → ${held.state}`)
    expect(held).toMatchObject({ state: 'review' })
    await db.query('UPDATE staff_presence SET last_seen_at = UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE')
    const results = await Promise.all([D.handOffToDerek(pool(), q.conversationId), D.handOffToDerek(pool(), q.conversationId)])
    const sent = results.filter((r) => r.state === 'sent').length
    console.info(`[live] handoff after Dev offline → sent ${sent} (0 is a safe outcome if the draft was held for quality)`)
    expect(sent).toBeLessThanOrEqual(1)
    expect((await rows("SELECT id FROM messages WHERE conversation_id = ? AND author_kind = 'derek'", [q.conversationId])).length).toBe(sent)
  })
})
