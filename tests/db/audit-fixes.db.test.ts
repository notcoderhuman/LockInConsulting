// Regression tests for the browser audit findings D1–D5 and the minor issues. Synthetic data,
// offline mock provider, no network. Run with `npm run test:db`.
import { randomUUID } from 'node:crypto'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { runAdminCli } from '../../scripts/admin-user.mjs'

const requestState = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => requestState.headers }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

type StudentActor = import('@/lib/student/access').StudentActor
type DerekStatus = import('@/lib/derek/config').DerekStatus
const C = await import('@/lib/support/conversations')
const D = await import('@/lib/derek/drafts')
const W = await import('@/lib/admin/workflow')
const { MockProvider } = await import('@/lib/derek/providers/mock')
const { createAuth } = await import('@/lib/auth')
const { throttleEmailSignIn, issueDeviceToken, reserveAttempt, pruneStaleRows, resetRequestBuckets, signInRateLimits, FREE_FAILURES, clock, DEVICE_COOKIE, MAX_DELAY_MS, QUIET_RESET_MS, CLEANUP_INTERVAL_MS } =
  await import('@/lib/auth-throttle')
// The real request budget, kept for the tests about it; the other tests sign in far faster than a
// person would (with a frozen clock), so they get an unlimited one.
const productionLimits = structuredClone(signInRateLimits)
signInRateLimits.global = { burst: 1e9, perSecond: 1e9 }
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
const { toNextJsHandler } = await import('better-auth/next-js')
const authRoute = await import('@/app/api/auth/[...all]/route')
const studentConversations = await import('@/app/api/student/conversations/route')
const studentMessages = await import('@/app/api/student/conversations/[id]/messages/route')
const actions = await import('@/app/admin/support-actions')
const ConversationPage = (await import('@/app/admin/(dashboard)/inbox/[id]/page')).default
const OverviewPage = (await import('@/app/admin/(dashboard)/page')).default
const NotificationsPage = (await import('@/app/admin/(dashboard)/notifications/page')).default
const TeamPage = (await import('@/app/admin/(dashboard)/team/page')).default

let server: TestDatabase
let db: Connection
const ORIGIN = 'http://localhost:3000'
const PASSWORD = 'correct horse battery staple'
const READY: DerekStatus = { state: 'ready', providerId: 'mock', notes: [], autoReply: { permitted: false, blockers: ['off'] } }
const reviewer = { userId: '', name: 'Fix Reviewer', email: 'fix-reviewer@test.example', role: 'reviewer' as const }
const cookies: Record<string, string> = {}
let student: StudentActor

const rid = () => randomUUID()
const pool = () => getAdminPool()
async function rows<R = RowDataPacket>(sql: string, params: unknown[] = []): Promise<R[]> {
  const [r] = await db.query<RowDataPacket[]>(sql, params)
  return r as R[]
}
const cli = (args: string[]) => runAdminCli(args, { env: process.env, readPassword: async () => PASSWORD, log: () => {}, actor: 'cli:test' }) as Promise<{ userId: string }>
const as = (who: string) => {
  requestState.headers = new Headers(cookies[who] ? { cookie: cookies[who] } : {})
}
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

function signInRequest(email: string, password: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email, password }),
  })
}
async function signIn(email: string): Promise<string> {
  const res = await authRoute.POST(signInRequest(email, PASSWORD))
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`)
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

beforeAll(async () => {
  server = await startTestDatabase()
  console.info(`[db] audit-fixes suite running on ${server.engine}`)
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  Object.assign(process.env, { DATABASE_URL: server.url, BETTER_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'), BETTER_AUTH_URL: ORIGIN, STUDENT_ACCOUNTS_ENABLED: 'true' })
  for (const k of ['AUTH_CLIENT_IP_HEADER', 'DEREK_AI_ENABLED', 'DEREK_PROVIDER', 'GEMINI_API_KEY']) delete process.env[k]

  reviewer.userId = (await cli(['create', '--email', reviewer.email, '--name', reviewer.name, '--role', 'reviewer'])).userId
  await cli(['create', '--email', 'fix-owner@test.example', '--name', 'Fix Owner', '--role', 'owner'])
  await cli(['create', '--email', 'fix-editor@test.example', '--name', 'Fix Editor', '--role', 'editor'])
  const stu = await cli(['create', '--email', 'fix-student@test.example', '--name', 'Fix Student', '--role', 'editor'])
  await db.query('DELETE FROM admin_members WHERE user_id = ?', [stu.userId])
  const [res] = await db.query("INSERT INTO student_profiles (user_id, display_name, age_confirmed_at) VALUES (?, 'Fix Student', UTC_TIMESTAMP(3))", [stu.userId])
  student = { userId: stu.userId, profileId: Number((res as { insertId: number }).insertId), displayName: 'Fix Student' }
  for (const who of ['reviewer', 'owner', 'editor', 'student']) cookies[who] = await signIn(`fix-${who}@test.example`)
}, 240_000)

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

describe('D1: stale Derek drafts', () => {
  it('a newer student message supersedes pending drafts, which can no longer be approved or sent', async () => {
    const first = await C.createConversation(pool(), student, { body: 'What is a conditional offer?', clientRequestId: rid() })
    await D.prepareDerekDraft(pool(), first.conversationId, first.triggerMessageId!, { status: READY, provider: new MockProvider() })
    const [stale] = await D.listDrafts(pool(), reviewer, first.conversationId)
    expect(stale).toMatchObject({ status: 'ready', answers: { messageId: first.messageId, excerpt: 'What is a conditional offer?' } })

    const follow = await C.sendStudentMessage(pool(), student, first.conversationId, { body: 'And what is an unconditional offer?', clientRequestId: rid() })
    const old = (await D.listDrafts(pool(), reviewer, first.conversationId)).find((d) => d.id === stale.id)!
    expect(old).toMatchObject({ status: 'superseded', supersededBy: 'newer_message' })
    await expect(D.approveAndSendDraft(pool(), reviewer, stale.id, { revision: stale.revision, bodySha256: stale.bodySha256 })).rejects.toMatchObject({ status: 409 })
    await expect(D.editDraft(pool(), reviewer, stale.id, { body: 'Edited', revision: stale.revision })).rejects.toMatchObject({ status: 409 })
    expect(await rows("SELECT id FROM messages WHERE conversation_id = ? AND author_kind = 'derek'", [first.conversationId])).toHaveLength(0)

    // The newer question gets its own draft, which answers the latest message and can be sent.
    await D.prepareDerekDraft(pool(), first.conversationId, follow.triggerMessageId!, { status: READY, provider: new MockProvider() })
    const current = (await D.listDrafts(pool(), reviewer, first.conversationId)).find((d) => d.status === 'ready')!
    expect(current.answers.messageId).toBe(follow.messageId)
    await D.approveAndSendDraft(pool(), reviewer, current.id, { revision: current.revision, bodySha256: current.bodySha256 })
  })

  it('a draft finishing after a newer student message is superseded, never made ready', async () => {
    const q = await C.createConversation(pool(), student, { body: 'What is a foundation year?', clientRequestId: rid() })
    const racing = {
      id: 'mock',
      model: 'mock-race',
      async generate() {
        await C.sendStudentMessage(pool(), student, q.conversationId, { body: 'Actually, what is a gap year?', clientRequestId: rid() })
        return { text: 'A foundation year is…', model: 'mock-race' }
      },
    }
    expect((await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: READY, provider: racing })).state).toBe('superseded')
    expect(await rows("SELECT id FROM ai_drafts WHERE conversation_id = ? AND status = 'ready'", [q.conversationId])).toHaveLength(0)
  })

  it('labels a draft superseded by a human reply accurately', async () => {
    const q = await C.createConversation(pool(), student, { body: 'What is deferral?', clientRequestId: rid() })
    await D.prepareDerekDraft(pool(), q.conversationId, q.triggerMessageId!, { status: READY, provider: new MockProvider() })
    await C.staffReply(pool(), reviewer, q.conversationId, { body: 'A person answered.', clientRequestId: rid() })
    expect((await D.listDrafts(pool(), reviewer, q.conversationId))[0]).toMatchObject({ status: 'superseded', supersededBy: 'human_reply' })
  })
})

describe('D2/D3: sign-in throttling', () => {
  const denied = { message: 'Too many requests. Please try again later.' }

  it('rotating a spoofed X-Forwarded-For does not avoid the per-account limit', async () => {
    await cli(['create', '--email', 'spoof-target@test.example', '--name', 'Spoof Target', '--role', 'editor'])
    for (let i = 1; i <= FREE_FAILURES; i++)
      expect((await authRoute.POST(signInRequest('spoof-target@test.example', 'wrong-password-1', { 'x-forwarded-for': `198.51.100.${i}` }))).status).toBe(401)
    const blocked = await authRoute.POST(signInRequest('spoof-target@test.example', PASSWORD, { 'x-forwarded-for': '198.51.100.99' }))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual(denied)
  })

  it('treats unknown accounts identically (no enumeration)', async () => {
    const known: { status: number; body: unknown }[] = []
    const unknown: { status: number; body: unknown }[] = []
    await cli(['create', '--email', 'enum-known@test.example', '--name', 'Known', '--role', 'editor'])
    for (let i = 0; i <= FREE_FAILURES; i++) {
      for (const [email, out] of [['enum-known@test.example', known], ['nobody-here@test.example', unknown]] as const) {
        const res = await authRoute.POST(signInRequest(email, 'wrong-password-1'))
        out.push({ status: res.status, body: await res.json() })
      }
    }
    expect(unknown).toEqual(known)
    expect(known.map((r) => r.status)).toEqual([...Array(FREE_FAILURES).fill(401), 429])
  })

  it('many users without any client IP never share one lockout bucket', async () => {
    for (const n of [1, 2, 3]) await cli(['create', '--email', `noip-${n}@test.example`, '--name', `No IP ${n}`, '--role', 'editor'])
    // Far beyond Better Auth's old shared per-path limit of 5, all without forwarded headers.
    for (let round = 0; round < 3; round++)
      for (const n of [1, 2, 3]) expect((await authRoute.POST(signInRequest(`noip-${n}@test.example`, PASSWORD))).status).toBe(200)
    // Another account locking itself out does not affect them.
    for (let i = 0; i < FREE_FAILURES + 1; i++) await authRoute.POST(signInRequest('noip-1@test.example', 'wrong-password-1'))
    expect((await authRoute.POST(signInRequest('noip-1@test.example', PASSWORD))).status).toBe(429)
    expect((await authRoute.POST(signInRequest('noip-2@test.example', PASSWORD))).status).toBe(200)
    expect(await rows("SELECT `key` FROM auth_rate_limit WHERE `key` LIKE 'no-trusted-ip%' OR `key` LIKE '127.0.0.1%' OR `key` LIKE '0000:%'")).toEqual([])
  })

  it('a successful sign-in clears earlier failures', async () => {
    await cli(['create', '--email', 'reset@test.example', '--name', 'Reset', '--role', 'editor'])
    for (let i = 0; i < FREE_FAILURES - 1; i++) await authRoute.POST(signInRequest('reset@test.example', 'wrong-password-1'))
    expect((await authRoute.POST(signInRequest('reset@test.example', PASSWORD))).status).toBe(200)
    for (let i = 0; i < FREE_FAILURES - 1; i++) expect((await authRoute.POST(signInRequest('reset@test.example', 'wrong-password-1'))).status).toBe(401)
  })

  it('with a trusted proxy header, IP limits use only that header and ignore X-Forwarded-For', async () => {
    process.env.AUTH_CLIENT_IP_HEADER = 'x-real-ip'
    try {
      const trusted = toNextJsHandler(createAuth()).POST
      const post = (email: string, headers: Record<string, string>) => throttleEmailSignIn(signInRequest(email, 'wrong-password-1', headers), trusted, getAuthPool())
      // Different accounts from one trusted client IP: Better Auth's per-IP limit (5 per 5 min) applies.
      const statuses = []
      for (let i = 0; i < 6; i++) statuses.push((await post(`ip-spray-${i}@test.example`, { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': `198.51.100.${i}` })).status)
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
      // Another real client is unaffected; forging X-Forwarded-For alone changes nothing.
      expect((await post('ip-spray-x@test.example', { 'x-real-ip': '203.0.113.8' })).status).toBe(401)
      expect((await post('ip-spray-y@test.example', { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '192.0.2.200' })).status).toBe(429)
    } finally {
      delete process.env.AUTH_CLIENT_IP_HEADER
    }
  })
})

describe('sign-in throttling cannot be used to lock a user out', () => {
  const realNow = clock.now
  let now = Date.now() + 60 * 60 * 1000 // clear of earlier tests' windows
  const advance = (ms: number) => (now += ms)
  const retryAfter = (res: Response) => Number(res.headers.get('retry-after'))
  const deviceCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${DEVICE_COOKIE}=`))
  const withCookie = (cookie: string | undefined): Record<string, string> => (cookie ? { cookie: cookie.split(';')[0] } : {})
  /** Keeps failing (no cookie) until the account is in a delayed state, without waiting it out. */
  async function failUntilBlocked(email: string) {
    for (let i = 0; i < 20; i++) if ((await authRoute.POST(signInRequest(email, 'attacker-guess-1'))).status === 429) return
    throw new Error('never blocked')
  }
  const storedHash = async (email: string) =>
    String((await rows<{ password: string }>("SELECT a.password FROM auth_account a JOIN auth_user u ON u.id = a.userId WHERE u.email = ? AND a.providerId = 'credential'", [email]))[0].password)
  async function account(name: string) {
    const email = `${name}-${Date.now()}@test.example`
    await cli(['create', '--email', email, '--name', name, '--role', 'editor'])
    return email
  }

  beforeAll(() => {
    clock.now = () => now
  })
  afterAll(() => {
    clock.now = realNow
  })

  it('delays grow 15 s → 30 s → 60 s → 120 s and stop at 3 minutes; quiet time resets them', async () => {
    const email = await account('progressive')
    for (let i = 0; i < FREE_FAILURES; i++) expect((await authRoute.POST(signInRequest(email, 'wrong-password-1'))).status).toBe(401)
    const waits: number[] = []
    for (let i = 0; i < 6; i++) {
      const blocked = await authRoute.POST(signInRequest(email, 'wrong-password-1'))
      expect(blocked.status).toBe(429)
      waits.push(retryAfter(blocked))
      advance(retryAfter(blocked) * 1000) // waiting out the delay always allows one more attempt
      expect((await authRoute.POST(signInRequest(email, 'wrong-password-1'))).status).toBe(401)
    }
    expect(waits).toEqual([15, 30, 60, 120, 180, 180])
    expect(Math.max(...waits) * 1000).toBe(MAX_DELAY_MS)
    advance(QUIET_RESET_MS)
    expect((await authRoute.POST(signInRequest(email, 'wrong-password-1'))).status).toBe(401) // free again
  })

  it('a targeted attack on a known email never blocks the victim’s recognised browser', async () => {
    const victim = await account('victim')
    const signedIn = await authRoute.POST(signInRequest(victim, PASSWORD))
    expect(signedIn.status).toBe(200)
    const cookie = deviceCookie(signedIn)!
    expect(cookie).toMatch(/; Path=\/api\/auth\/sign-in; Max-Age=\d+; HttpOnly; SameSite=Lax/)

    // The attacker keeps failing for a long time, waiting out each delay, without the victim's cookie.
    for (let i = 0; i < 20; i++) {
      const res = await authRoute.POST(signInRequest(victim, 'attacker-guess-1', { 'x-forwarded-for': `198.51.100.${i}` }))
      if (res.status === 429) advance(retryAfter(res) * 1000)
    }
    await failUntilBlocked(victim)
    expect((await authRoute.POST(signInRequest(victim, 'attacker-guess-1'))).status).toBe(429)
    // The victim's own browser signs straight in, mid-attack.
    expect((await authRoute.POST(signInRequest(victim, PASSWORD, withCookie(cookie)))).status).toBe(200)
  })

  it('a new browser waits at most the bounded delay, then signs in and clears the delay', async () => {
    const victim = await account('newdevice')
    for (let i = 0; i < 12; i++) {
      const res = await authRoute.POST(signInRequest(victim, 'attacker-guess-1'))
      if (res.status === 429) advance(retryAfter(res) * 1000)
    }
    await failUntilBlocked(victim)
    const blocked = await authRoute.POST(signInRequest(victim, PASSWORD))
    expect(blocked.status).toBe(429)
    expect(retryAfter(blocked)).toBeLessThanOrEqual(MAX_DELAY_MS / 1000)
    advance(retryAfter(blocked) * 1000)
    const ok = await authRoute.POST(signInRequest(victim, PASSWORD))
    expect(ok.status).toBe(200)
    expect(deviceCookie(ok)).toBeTruthy()
    // Recovery: the account's failures were cleared by the successful sign-in.
    for (let i = 0; i < FREE_FAILURES; i++) expect((await authRoute.POST(signInRequest(victim, 'wrong-password-1'))).status).toBe(401)
  })

  it('device cookies are bound to one account, tamper-proof, and their own failures stay in their own bucket', async () => {
    const a = await account('cookie-a')
    const b = await account('cookie-b')
    const cookieA = deviceCookie(await authRoute.POST(signInRequest(a, PASSWORD)))!
    for (let i = 0; i < FREE_FAILURES; i++) await authRoute.POST(signInRequest(b, 'attacker-guess-1'))
    // A's cookie does not count as a recognised device for B.
    expect((await authRoute.POST(signInRequest(b, PASSWORD, withCookie(cookieA)))).status).toBe(429)
    // A tampered cookie is ignored (treated as an unrecognised browser).
    const [name, value] = cookieA.split(';')[0].split('=')
    const tampered = `${name}=${value.slice(0, -2)}xx`
    for (let i = 0; i < FREE_FAILURES; i++) await authRoute.POST(signInRequest(a, 'attacker-guess-1'))
    expect((await authRoute.POST(signInRequest(a, PASSWORD, { cookie: tampered }))).status).toBe(429)
    expect((await authRoute.POST(signInRequest(a, PASSWORD, withCookie(cookieA)))).status).toBe(200)

    // Someone mistyping on the recognised browser is throttled there, not for other browsers.
    const c = await account('cookie-c')
    const cookieC = deviceCookie(await authRoute.POST(signInRequest(c, PASSWORD)))!
    for (let i = 0; i < FREE_FAILURES; i++) await authRoute.POST(signInRequest(c, 'typo-password-1', withCookie(cookieC)))
    expect((await authRoute.POST(signInRequest(c, PASSWORD, withCookie(cookieC)))).status).toBe(429)
    expect((await authRoute.POST(signInRequest(c, PASSWORD))).status).toBe(200)
  })

  it('known and unknown emails get identical statuses, bodies and delays', async () => {
    const known = await account('identical')
    const trace = async (email: string) => {
      const out: string[] = []
      for (let i = 0; i < FREE_FAILURES + 2; i++) {
        const res = await authRoute.POST(signInRequest(email, 'wrong-password-1'))
        out.push(`${res.status}|${res.headers.get('retry-after') ?? '-'}|${await res.text()}|${res.headers.getSetCookie().some((c) => c.startsWith(DEVICE_COOKIE))}`)
      }
      return out
    }
    expect(await trace(`never-registered-${Date.now()}@test.example`)).toEqual(await trace(known))
  })

  it('takes comparable time to reject a known and an unknown email', async () => {
    const known = await account('timing')
    const time = async (email: string) => {
      const samples: number[] = []
      for (let i = 0; i < 7; i++) {
        advance(QUIET_RESET_MS) // stay inside the free attempts
        const t = performance.now()
        await authRoute.POST(signInRequest(email, 'wrong-password-1'))
        samples.push(performance.now() - t)
      }
      return samples.sort((x, y) => x - y)[3]
    }
    const [k, u] = [await time(known), await time(`nobody-timing-${Date.now()}@test.example`)]
    console.info(`[timing] median rejection: known ${k.toFixed(1)} ms, unknown ${u.toFixed(1)} ms`)
    // Better Auth hashes the password for unknown users too; a large gap would reveal accounts.
    expect(u / k).toBeGreaterThan(0.5)
    expect(u / k).toBeLessThan(2)
  })

  // Security review: rotating browsers, cookies or forwarded headers, or sending guesses in
  // parallel, must not raise the per-account guessing rate.
  const statusCounts = (responses: Response[]) => responses.reduce<Record<number, number>>((n, r) => ({ ...n, [r.status]: (n[r.status] ?? 0) + 1 }), {})
  const parallelGuesses = (email: string, n: number, headers: (i: number) => Record<string, string> = () => ({})) =>
    Promise.all(Array.from({ length: n }, (_, i) => authRoute.POST(signInRequest(email, `parallel-guess-${i}`, headers(i)))))

  it('parallel guesses from fresh browsers, junk cookies and rotating X-Forwarded-For get only the free attempts', async () => {
    const email = await account('parallel')
    const jars = (i: number): Record<string, string> =>
      [{}, { cookie: `${DEVICE_COOKIE}=junk-${i}` }, { cookie: `other=1; ${DEVICE_COOKIE}=a.b.c.d` }, { 'x-forwarded-for': `198.51.100.${i}` }][i % 4]
    expect(statusCounts(await parallelGuesses(email, 40, jars))).toEqual({ 401: FREE_FAILURES, 429: 40 - FREE_FAILURES })
    // Once the delay has passed, a parallel burst still gets exactly one attempt.
    advance(MAX_DELAY_MS)
    expect(statusCounts(await parallelGuesses(email, 40, jars))).toEqual({ 401: 1, 429: 39 })
  })

  it('cookies cannot be minted for another account without the server secret', async () => {
    const victim = await account('mint-victim')
    await failUntilBlocked(victim)
    const forged = [
      issueDeviceToken(victim, 'attacker-guessed-secret'.padEnd(48, 'y'), await storedHash(victim)), // valid shape, wrong key
      issueDeviceToken(`someone-else-${Date.now()}@test.example`, process.env.BETTER_AUTH_SECRET!, 'x'), // right key, other account
      issueDeviceToken(victim, process.env.BETTER_AUTH_SECRET!, 'guessed-hash'), // right key and account, wrong password state
    ]
    for (const token of forged) expect((await authRoute.POST(signInRequest(victim, PASSWORD, { cookie: `${DEVICE_COOKIE}=${token}` }))).status).toBe(429)
  })

  it('the victim’s recognised browser signs in during a parallel attack', async () => {
    const victim = await account('parallel-victim')
    const cookie = deviceCookie(await authRoute.POST(signInRequest(victim, PASSWORD)))!
    const [attack, own] = await Promise.all([parallelGuesses(victim, 30), authRoute.POST(signInRequest(victim, PASSWORD, withCookie(cookie)))])
    expect(own.status).toBe(200)
    expect(attack.filter((r) => r.status === 401).length).toBeLessThanOrEqual(FREE_FAILURES)
  })

  it('pausing under an hour does not regain the free attempts', async () => {
    const email = await account('pause')
    await failUntilBlocked(email)
    advance(59 * 60_000) // absolute, not relative to QUIET_RESET_MS: a shorter reset must fail this
    expect((await authRoute.POST(signInRequest(email, 'wrong-password-1'))).status).toBe(401) // the delay passed: one attempt
    expect((await authRoute.POST(signInRequest(email, 'wrong-password-1'))).status).toBe(429) // but not the free five
    advance(QUIET_RESET_MS)
    expect(statusCounts(await parallelGuesses(email, 10))).toEqual({ 401: FREE_FAILURES, 429: 10 - FREE_FAILURES })
  })

  // Follow-up review: form bodies, password changes, routine sign-ins and session-only password checks.
  const rawSignIn = (body: BodyInit, contentType: string | null, path = '/sign-in/email', headers: Record<string, string> = {}) =>
    authRoute.POST(new Request(`${ORIGIN}/api/auth${path}`, { method: 'POST', headers: { origin: ORIGIN, ...(contentType ? { 'content-type': contentType } : {}), ...headers }, body }))
  const setPassword = (email: string, password: string) =>
    runAdminCli(['set-password', '--email', email], { env: process.env, readPassword: async () => password, log: () => {}, actor: 'cli:test' })

  it('only JSON bodies reach password verification; form-encoded and other types cannot bypass the throttle', async () => {
    const email = await account('content-type')
    const form = () => new URLSearchParams({ email, password: PASSWORD }).toString()
    const multipart = () => {
      const f = new FormData()
      f.set('email', email)
      f.set('password', PASSWORD)
      return f
    }
    const json = JSON.stringify({ email, password: PASSWORD })
    // Even with the correct password, none of these is ever checked (a check would answer 200).
    const refused = await Promise.all([
      ...Array.from({ length: 30 }, () => rawSignIn(form(), 'application/x-www-form-urlencoded')),
      rawSignIn(form(), 'Application/X-WWW-Form-Urlencoded; charset=utf-8'),
      rawSignIn(multipart(), null),
      rawSignIn(json, 'text/plain'),
      rawSignIn(json, null),
      rawSignIn(json, 'application/json, application/x-www-form-urlencoded'),
      rawSignIn(json, 'application/vnd.api+json'),
    ])
    expect(statusCounts(refused)).toEqual({ 415: refused.length })
    expect(await refused[0].json()).toEqual({ message: 'Unsupported content type.' })
    // None used a slot: all free attempts remain, and JSON (with a charset) still signs in.
    for (let i = 0; i < FREE_FAILURES - 1; i++) expect((await authRoute.POST(signInRequest(email, 'wrong-password-1'))).status).toBe(401)
    expect((await rawSignIn(json, 'application/json; charset=utf-8')).status).toBe(200)
  })

  it('malformed JSON requests are rejected without a password check or a used slot', async () => {
    const email = await account('malformed')
    const bad = [
      rawSignIn('{"email":', 'application/json'),
      rawSignIn('[]', 'application/json'),
      rawSignIn(JSON.stringify({ password: PASSWORD }), 'application/json'),
      rawSignIn(JSON.stringify({ email: [email], password: PASSWORD }), 'application/json'),
      rawSignIn(JSON.stringify({ email, password: PASSWORD, pad: 'x'.repeat(17_000) }), 'application/json'),
    ]
    for (const res of await Promise.all(bad)) expect(res.status).toBe(400)
    for (let i = 0; i < FREE_FAILURES; i++) expect((await authRoute.POST(signInRequest(email, 'wrong-password-1'))).status).toBe(401)
  })

  it('a password change invalidates every device cookie issued before it', async () => {
    const victim = await account('password-change')
    const NEW_PASSWORD = 'a different synthetic passphrase'
    // Cookie rotation: each sign-in issues a new cookie, and each works until the password changes.
    const before = [deviceCookie(await authRoute.POST(signInRequest(victim, PASSWORD)))!, deviceCookie(await authRoute.POST(signInRequest(victim, PASSWORD)))!]
    expect(before[0]).not.toEqual(before[1])
    await setPassword(victim, NEW_PASSWORD)
    await failUntilBlocked(victim)
    // Old cookies are now unrecognised browsers: they share the blocked account bucket, even in parallel.
    const stale = await Promise.all([...before, ...before].map((c) => authRoute.POST(signInRequest(victim, NEW_PASSWORD, withCookie(c)))))
    expect(statusCounts(stale)).toEqual({ 429: 4 })
    // Recovery: after the bounded delay the new password signs in and its fresh cookie is recognised.
    advance(MAX_DELAY_MS)
    const fresh = deviceCookie(await authRoute.POST(signInRequest(victim, NEW_PASSWORD)))!
    await failUntilBlocked(victim)
    expect((await authRoute.POST(signInRequest(victim, NEW_PASSWORD, withCookie(fresh)))).status).toBe(200)
    expect((await authRoute.POST(signInRequest(victim, NEW_PASSWORD, withCookie(before[0])))).status).toBe(429)
  })

  it('the owner signing in on a recognised browser does not reset an attacker’s delay', async () => {
    const victim = await account('no-reset')
    const cookie = deviceCookie(await authRoute.POST(signInRequest(victim, PASSWORD)))!
    await failUntilBlocked(victim)
    expect((await authRoute.POST(signInRequest(victim, PASSWORD, withCookie(cookie)))).status).toBe(200)
    expect((await authRoute.POST(signInRequest(victim, 'attacker-guess-1'))).status).toBe(429)
  })

  it('a signed-in session cannot check or change the password over HTTP', async () => {
    const email = await account('session-guess')
    const session = await signIn(email)
    const attempts = await Promise.all([
      rawSignIn(JSON.stringify({ currentPassword: 'guess-1-password', newPassword: 'another long password' }), 'application/json', '/change-password', { cookie: session }),
      rawSignIn(JSON.stringify({ password: 'guess-1-password' }), 'application/json', '/verify-password', { cookie: session }),
    ])
    expect(attempts.map((r) => r.status)).toEqual([404, 404])
    expect((await authRoute.POST(signInRequest(email, PASSWORD))).status).toBe(200) // password unchanged
  })

  describe('request budget before password hashing (CPU protection)', () => {
    let hashed = 0
    // Stands in for Better Auth: every call is one password hash.
    const hashing = (status = 401) => async () => {
      hashed++
      return Response.json({ message: 'Invalid email or password' }, { status })
    }
    const post = (email: string, headers: Record<string, string> = {}, handle = hashing()) =>
      throttleEmailSignIn(signInRequest(email, 'guess-password-1', headers), handle, getAuthPool())
    const someone = () => `flood-${randomUUID()}@test.example`
    const spoofed = (i: number): Record<string, string> =>
      [{}, { 'x-forwarded-for': `198.51.100.${i % 250}` }, { 'x-real-ip': `192.0.2.${i % 250}` }, { forwarded: `for=203.0.113.${i % 250}` }][i % 4]

    beforeEach(() => {
      signInRateLimits.global = { ...productionLimits.global }
      signInRateLimits.perIp = { ...productionLimits.perIp }
      resetRequestBuckets()
      hashed = 0
    })
    afterEach(() => {
      signInRateLimits.global = { burst: 1e9, perSecond: 1e9 }
      delete process.env.AUTH_CLIENT_IP_HEADER
      resetRequestBuckets()
    })

    it('a flood of unknown emails is hashed only as fast as the budget allows, whatever IP headers it sends', async () => {
      const { burst, perSecond } = productionLimits.global
      const first = await Promise.all(Array.from({ length: 40 }, (_, i) => post(someone(), spoofed(i))))
      expect(statusCounts(first)).toEqual({ 401: burst, 429: 40 - burst })
      expect(hashed).toBe(burst)
      expect(first.find((r) => r.status === 429)!.headers.get('retry-after')).toBe('1')
      advance(1000)
      const next = await Promise.all(Array.from({ length: 40 }, (_, i) => post(someone(), spoofed(i))))
      expect(statusCounts(next)).toEqual({ 401: perSecond, 429: 40 - perSecond })
      expect(hashed).toBe(burst + perSecond)
    })

    it('the owner’s recognised browser still signs in while a flood has used up the budget', async () => {
      signInRateLimits.global = { burst: 1e9, perSecond: 1e9 }
      const owner = await account('flood-owner')
      const cookie = deviceCookie(await authRoute.POST(signInRequest(owner, PASSWORD)))!
      signInRateLimits.global = { ...productionLimits.global }
      resetRequestBuckets()
      await Promise.all(Array.from({ length: 30 }, () => post(someone())))
      expect((await authRoute.POST(signInRequest(owner, PASSWORD))).status).toBe(429) // unrecognised browser waits
      expect((await authRoute.POST(signInRequest(owner, PASSWORD, withCookie(cookie)))).status).toBe(200)
    })

    it('requests that never hash a password give their token back', async () => {
      const { burst } = productionLimits.global
      const target = someone()
      for (let i = 0; i < 30; i++) await post(target) // the account schedule refuses all but the free attempts
      expect(hashed).toBe(FREE_FAILURES)
      for (let i = 0; i < 20; i++) expect((await post(someone(), {}, hashing(400))).status).toBe(400) // rejected before hashing
      hashed = 0
      expect(statusCounts(await Promise.all(Array.from({ length: 20 }, () => post(someone()))))).toEqual({ 401: burst - FREE_FAILURES, 429: 20 - (burst - FREE_FAILURES) })
    })

    it('with a verified proxy header, one client IP cannot use up the shared budget, and a missing IP gets no extra', async () => {
      process.env.AUTH_CLIENT_IP_HEADER = 'x-real-ip'
      const { burst: ipBurst } = productionLimits.perIp
      const flood = await Promise.all(Array.from({ length: 100 }, (_, i) => post(someone(), { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': `198.51.100.${i % 250}` })))
      expect(statusCounts(flood)).toEqual({ 401: ipBurst, 429: 100 - ipBurst })
      expect((await post(someone(), { 'x-real-ip': '203.0.113.8' })).status).toBe(401) // another client still gets in
      advance(3000) // refill the shared budget; per-IP buckets refill far more slowly
      hashed = 0
      const missing = []
      for (let i = 0; i < 8; i++) missing.push(await post(someone(), spoofed(i % 2 ? 1 : 3))) // no x-real-ip: one shared bucket
      expect(statusCounts(missing)).toEqual({ 401: ipBurst, 429: 8 - ipBurst })
      expect(hashed).toBe(ipBurst)
    })
  })

  describe('stale throttle rows are cleaned up', () => {
    const insertRow = (key: string, count: number, lastRequest: number) =>
      db.query('INSERT INTO auth_rate_limit (id, `key`, `count`, lastRequest) VALUES (?, ?, ?, ?)', [randomUUID(), key, count, lastRequest])
    const row = async (key: string) => (await rows<{ count: number; lastRequest: string }>('SELECT `count`, lastRequest FROM auth_rate_limit WHERE `key` = ?', [key]))[0]
    const failedSignIn = () => throttleEmailSignIn(signInRequest(`nobody-${randomUUID()}@test.example`, 'guess-password-1'), async () => Response.json({}, { status: 401 }), getAuthPool())

    beforeEach(() => resetRequestBuckets()) // cleanup is due on the next request

    it('removes idle rows even when nobody ever signs in successfully, and keeps active counters exactly', async () => {
      const id = randomUUID()
      const stale = [`account:stale-${id}|/sign-in/email`, `device:stale-${id}|/sign-in/email`, `198.51.100.${id.length}-${id}|/sign-in/email`]
      for (const key of stale) await insertRow(key, 9, now - QUIET_RESET_MS - 1)
      const active = `account:active-${id}|/sign-in/email`
      await insertRow(active, 6, now - 10_000)

      expect((await failedSignIn()).status).toBe(401)
      for (const key of stale) expect(await row(key)).toBeUndefined()
      const kept = await row(active)
      expect([Number(kept.count), Number(kept.lastRequest)]).toEqual([6, now - 10_000])
      // Its schedule is unchanged: after 6 attempts the next waits 30 s, 10 s of which have passed.
      expect(await reserveAttempt(getAuthPool(), active)).toBe(20_000)
    })

    it('runs at most once per interval and deletes a bounded batch', async () => {
      const id = randomUUID()
      expect((await failedSignIn()).status).toBe(401) // this run happens now
      const late = `account:late-${id}|/sign-in/email`
      await insertRow(late, 3, now - QUIET_RESET_MS - 1)
      await failedSignIn()
      expect(await row(late)).toBeDefined() // not again within the interval
      advance(CLEANUP_INTERVAL_MS)
      await failedSignIn()
      expect(await row(late)).toBeUndefined()

      const batch = [1, 2, 3].map((n) => `account:batch-${n}-${id}|/sign-in/email`)
      for (const key of batch) await insertRow(key, 1, now - QUIET_RESET_MS - 1)
      expect(await pruneStaleRows(getAuthPool(), now, 2)).toBe(2)
      expect((await Promise.all(batch.map(row))).filter(Boolean)).toHaveLength(1)
    })
  })
})

describe('D4: page loads and GET requests never change state', () => {
  async function snapshot(conversationId: number) {
    const [conv] = await rows<{ staff_last_read_id: number }>('SELECT staff_last_read_id FROM conversations WHERE id = ?', [conversationId])
    const [[reads], [notes]] = await Promise.all([
      rows<{ n: number }>('SELECT COUNT(*) AS n FROM notification_reads'),
      rows<{ n: number }>('SELECT COUNT(*) AS n FROM notifications'),
    ])
    return { lastRead: Number(conv.staff_last_read_id), reads: Number(reads.n), notifications: Number(notes.n) }
  }

  it('rendering the conversation, overview and notifications pages repeatedly writes nothing', async () => {
    const q = await C.createConversation(pool(), student, { body: 'What is a credit transfer?', clientRequestId: rid() })
    // An overdue published record that the old render path would have turned into a notice.
    const src = await W.createSource(pool(), { ...reviewer, role: 'editor' }, form({ url: `https://uni.example/${rid()}`, title: 'Synthetic', publisher: 'Synthetic', sourceType: 'university_official', retrievedAt: '2026-10-01' }))
    const uni = await W.createRecord(pool(), { ...reviewer, role: 'editor' }, 'university', form({ name: 'Overdue Synthetic University', slug: `overdue-${Date.now()}`, destinationIso2: 'DE', officialWebsite: 'https://uni.example/', sourceId: String(src) }), null)
    await W.transitionRecord(pool(), { ...reviewer, role: 'editor' }, 'university', uni, 'submit_for_review', form({}))
    await W.transitionRecord(pool(), reviewer, 'university', uni, 'verify', form({ verificationStatus: 'verified', sourceId: String(src), checkedAt: '2026-10-01', reviewDueAt: '2027-01-01' }))
    await W.transitionRecord(pool(), reviewer, 'university', uni, 'publish', form({}))
    await db.query("UPDATE universities SET checked_at = '2026-01-01', review_due_at = '2026-02-01' WHERE id = ?", [uni])

    const before = await snapshot(q.conversationId)
    as('reviewer')
    for (let i = 0; i < 3; i++) {
      await ConversationPage({ params: Promise.resolve({ id: String(q.conversationId) }), searchParams: Promise.resolve({}) })
      await OverviewPage()
      await NotificationsPage({ searchParams: Promise.resolve({}) })
    }
    expect(await snapshot(q.conversationId)).toEqual(before)
    expect(await rows("SELECT id FROM notifications WHERE kind = 'review_overdue'")).toHaveLength(0)
  })

  it('the deliberate POST actions do the work, with their own authorisation', async () => {
    const q = await C.createConversation(pool(), student, { body: 'What is clearing?', clientRequestId: rid() })
    as('editor') // no support access, no review rights
    expect(await actions.markConversationReadAction(null, form({ conversationId: String(q.conversationId) }))).toMatchObject({ ok: false })
    expect(await actions.syncReviewNoticesAction(null, form({}))).toMatchObject({ ok: false })
    expect((await snapshot(q.conversationId)).lastRead).toBe(0)

    as('reviewer')
    expect(await actions.markConversationReadAction(null, form({ conversationId: String(q.conversationId) }))).toMatchObject({ ok: true })
    expect((await snapshot(q.conversationId)).lastRead).toBe(q.messageId)
    expect(await actions.syncReviewNoticesAction(null, form({}))).toMatchObject({ ok: true })
    expect(await actions.syncReviewNoticesAction(null, form({}))).toMatchObject({ ok: true })
    expect(await rows("SELECT id FROM notifications WHERE kind = 'review_overdue'")).toHaveLength(1)
  })
})

describe('D5: students see friendly labels only', () => {
  it('never exposes internal statuses, including review and failure states', async () => {
    const review = await C.createConversation(pool(), student, { body: 'What is a deposit?', clientRequestId: rid() })
    await D.prepareDerekDraft(pool(), review.conversationId, review.triggerMessageId!, { status: READY, provider: new MockProvider() })
    const failed = await C.createConversation(pool(), student, { body: 'What is an offer holder day?', clientRequestId: rid() })
    await D.prepareDerekDraft(pool(), failed.conversationId, failed.triggerMessageId!, { status: READY, provider: new MockProvider({ kind: 'fail', retryable: false }), callOptions: { retryDelayMs: 0 } })
    expect((await rows<{ status: string }>('SELECT status FROM conversations WHERE id IN (?, ?) ORDER BY id', [review.conversationId, failed.conversationId])).map((r) => r.status)).toEqual(['awaiting_human_review', 'failed'])

    const get = (url: string, params?: { id: string }) => {
      const req = new Request(`${ORIGIN}${url}`, { headers: { cookie: cookies.student } })
      return params ? studentMessages.GET(req, { params: Promise.resolve(params) }) : studentConversations.GET(req)
    }
    const bodies = [
      await (await get('/api/student/conversations')).text(),
      await (await get(`/api/student/conversations/${review.conversationId}/messages`, { id: String(review.conversationId) })).text(),
      await (await get(`/api/student/conversations/${failed.conversationId}/messages`, { id: String(failed.conversationId) })).text(),
    ]
    for (const body of bodies) {
      expect(body).not.toMatch(/"status"|awaiting_human_review|awaiting_student_reply|"failed"|\bfailed\b/)
      expect(body).toContain('Waiting for the LockIn team')
    }
  })
})

describe('minor: revoking a member needs confirmation and reports it', () => {
  it('refuses without the confirmation step, then confirms on the Team page', async () => {
    const target = await cli(['create', '--email', 'revoke-me@test.example', '--name', 'Revoke Me', '--role', 'editor'])
    as('owner')
    expect(await actions.revokeMemberAction(null, form({ userId: target.userId, reason: 'Synthetic test' }))).toMatchObject({ ok: false, message: expect.stringMatching(/Confirm/) })
    expect((await rows<{ status: string }>('SELECT status FROM admin_members WHERE user_id = ?', [target.userId]))[0].status).toBe('active')
    await expect(actions.revokeMemberAction(null, form({ userId: target.userId, reason: 'Synthetic test', confirm: 'yes' }))).rejects.toThrow('NEXT_REDIRECT:/admin/team?notice=revoked')
    expect((await rows<{ status: string }>('SELECT status FROM admin_members WHERE user_id = ?', [target.userId]))[0].status).toBe('revoked')
    const page = JSON.stringify(await TeamPage({ searchParams: Promise.resolve({ notice: 'revoked' }) }))
    expect(page).toContain('Access revoked. All of their sessions were signed out.')
    expect(JSON.stringify(await TeamPage({ searchParams: Promise.resolve({ notice: '<script>' }) }))).not.toContain('Access revoked')
  })
})

