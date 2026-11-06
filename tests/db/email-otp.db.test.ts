// Emailed one-time codes, account linking and session revocation for students, through the real
// route handler, Better Auth and a real database. Offline: mail is captured in memory and Google's
// token endpoint is stubbed with a synthetic ID token. Run with `pnpm test:db`.
import { randomUUID } from 'node:crypto'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) } }))

const { getAuth } = await import('@/lib/auth')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
const { mailer } = await import('@/lib/mail')
const { clock, resetRequestBuckets } = await import('@/lib/auth-throttle')
const { OTP_LIMITS } = await import('@/lib/auth-otp')
const authRoute = await import('@/app/api/auth/[...all]/route')
const ageRoute = await import('@/app/api/student/age-confirmation/route')
const profileRoute = await import('@/app/api/student/profile/route')
const accountRoute = await import('@/app/api/student/account/route')
const conversationsRoute = await import('@/app/api/student/conversations/route')
const { resolveStudentContext } = await import('@/lib/student/access')
const { PRIVACY_NOTICE_VERSION } = await import('@/lib/student/onboarding')
const { AGE_CONFIRM_LIMITS } = await import('@/lib/student/age-attestation')
const { createStudentProfile } = await import('@/lib/student/onboarding')
const messagesRoute = await import('@/app/api/student/conversations/[id]/messages/route')
const { canStartStudentProfile } = await import('@/lib/student/onboarding')

const BASE = 'http://localhost:3000'
const CLIENT_ID = 'synthetic-client-id.apps.googleusercontent.com'
Object.assign(process.env, {
  BETTER_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'),
  BETTER_AUTH_URL: BASE,
  STUDENT_ACCOUNTS_ENABLED: 'true',
  STUDENT_SELF_SIGNUP_ENABLED: 'true',
  SMTP_HOST: 'smtp.invalid',
  SMTP_USER: 'synthetic',
  SMTP_PASSWORD: 'synthetic-not-real',
  MAIL_FROM: 'LockIn <no-reply@test.example>',
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'synthetic-client-secret-not-real',
})

let server: TestDatabase
let db: Connection
let now = Date.UTC(2026, 10, 5, 9)
const sent: { to: string; subject: string; text: string }[] = []
const rows = async <R = RowDataPacket>(sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0] as R[]

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  process.env.DATABASE_URL = server.url
  mailer.send = async (m) => {
    sent.push(m)
  }
  clock.now = () => now
}, 240_000)

beforeEach(async () => {
  resetRequestBuckets()
  await db.query('DELETE FROM auth_rate_limit')
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

const cookiesFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const post = (path: string, body: unknown, cookie = '') =>
  authRoute.POST(new Request(`${BASE}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify(body) }))
const codeFor = (email: string) => sent.filter((m) => m.to === email).at(-1)?.text.match(/\b(\d{6})\b/)?.[1]
const sendCode = (email: string, type = 'sign-in') => post('/email-otp/send-verification-otp', { email, type })
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')
const sessionOf = async (cookie: string) => getAuth()!.api.getSession({ headers: new Headers({ cookie }) })

async function confirmAge() {
  const res = await ageRoute.POST(
    new Request(`${BASE}/api/student/age-confirmation`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ fullName: 'Synthetic Adult Student', ageConfirmed: true }) }),
  )
  expect(res.status).toBe(200)
  return cookiesFrom(res)
}

/** A new student account made with an emailed code alone: verified email, no access yet. Returns the session cookie. */
async function signUp(email: string) {
  expect((await sendCode(email)).status).toBe(200)
  const res = await post('/sign-in/email-otp', { email, otp: codeFor(email) })
  expect(res.status).toBe(200)
  now += OTP_LIMITS.cooldownMs + 1
  return cookiesFrom(res)
}

async function staff(email: string) {
  const id = randomUUID()
  await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3))', [id, 'Synthetic Owner', email])
  await db.query("INSERT INTO admin_members (user_id, role, status, granted_by) VALUES (?, 'owner', 'active', 'cli:test')", [id])
  return id
}

describe('emailed one-time codes', () => {
  it('creates a verified account with no access, and stores no usable code', async () => {
    const email = 'otp-new@test.example'
    expect((await sendCode(email)).status).toBe(200)
    const code = codeFor(email)!
    expect(code).toMatch(/^\d{6}$/)
    // HMAC with the server secret: neither the code nor its plain SHA-256 is in the database.
    const [stored] = await rows<{ value: string }>('SELECT value FROM auth_verification WHERE identifier = ?', [`sign-in-otp-${email}`])
    expect(stored.value).not.toContain(code)
    const res = await post('/sign-in/email-otp', { email, otp: code })
    expect(res.status).toBe(200)
    const cookie = cookiesFrom(res)
    const [user] = await rows<{ id: string; emailVerified: number }>('SELECT id, emailVerified FROM auth_user WHERE email = ?', [email])
    expect(user.emailVerified).toBe(1)
    expect((await sessionOf(cookie))?.user.email).toBe(email)
    // No team role and no profile: the name, 18+ and privacy step comes next, and it is allowed.
    expect(await rows('SELECT id FROM student_profiles WHERE user_id = ?', [user.id])).toHaveLength(0)
    expect(await resolveStudentContext(new Headers({ cookie }))).toMatchObject({ state: 'needs_profile' })
    expect(await canStartStudentProfile(user.id)).toBe(true)
    // The code is gone after use: a second sign-in needs a new one.
    expect((await post('/sign-in/email-otp', { email, otp: code })).status).toBe(400)
    expect(await rows('SELECT id FROM auth_verification WHERE identifier = ?', [`sign-in-otp-${email}`])).toHaveLength(0)
  })

  it('refuses a wrong code, then locks the code after three wrong tries', async () => {
    const email = 'otp-wrong@test.example'
    await signUp(email)
    await sendCode(email)
    const code = codeFor(email)!
    for (let i = 0; i < 3; i++) expect(await (await post('/sign-in/email-otp', { email, otp: wrong(code) })).json()).toMatchObject({ code: 'INVALID_OTP' })
    const res = await post('/sign-in/email-otp', { email, otp: code })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' })
  })

  it('accepts a code once only, and never after it expires', async () => {
    const email = 'otp-once@test.example'
    await signUp(email)
    await sendCode(email)
    const code = codeFor(email)!
    expect((await post('/sign-in/email-otp', { email, otp: code })).status).toBe(200)
    expect((await post('/sign-in/email-otp', { email, otp: code })).status).toBe(400)

    now += OTP_LIMITS.cooldownMs + 1
    await sendCode(email)
    await db.query('UPDATE auth_verification SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE identifier = ?', [`sign-in-otp-${email}`])
    const expired = await post('/sign-in/email-otp', { email, otp: codeFor(email) })
    expect(expired.status).toBe(400)
    expect(await expired.json()).toMatchObject({ code: 'OTP_EXPIRED' })
  })

  it('enforces the resend cooldown, keeps only the newest code, and caps sends and guesses per email', async () => {
    const email = 'otp-limits@test.example'
    await signUp(email)
    expect((await sendCode(email)).status).toBe(200)
    const first = codeFor(email)!
    const tooSoon = await sendCode(email)
    expect(tooSoon.status).toBe(429)
    expect(Number(tooSoon.headers.get('retry-after'))).toBeGreaterThan(0)
    now += OTP_LIMITS.cooldownMs + 1
    expect((await sendCode(email)).status).toBe(200)
    const second = codeFor(email)!
    if (first !== second) expect((await post('/sign-in/email-otp', { email, otp: first })).status).toBe(400)
    // signUp's send counted too: 1 + 2 so far; the hourly cap allows OTP_LIMITS.sendsPerHour.
    for (let i = 3; i < OTP_LIMITS.sendsPerHour; i++) {
      now += OTP_LIMITS.cooldownMs + 1
      expect((await sendCode(email)).status).toBe(200)
    }
    now += OTP_LIMITS.cooldownMs + 1
    expect((await sendCode(email)).status).toBe(429)
    // Other emails are unaffected.
    expect((await sendCode('otp-someone-else@test.example')).status).toBe(200)

    const guesser = 'otp-guesses@test.example'
    await db.query('DELETE FROM auth_rate_limit')
    for (let i = 0; i < OTP_LIMITS.verifiesPerHour; i++) expect((await post('/sign-in/email-otp', { email: guesser, otp: '000000' })).status).not.toBe(429)
    expect((await post('/sign-in/email-otp', { email: guesser, otp: '000000' })).status).toBe(429)
    now += 60 * 60 * 1000 + 1
    expect((await post('/sign-in/email-otp', { email: guesser, otp: '000000' })).status).not.toBe(429)
  })

  it('refuses other purposes and non-JSON bodies before Better Auth sees them', async () => {
    expect((await sendCode('x@test.example', 'email-verification')).status).toBe(400)
    expect((await post('/email-otp/check-verification-otp', { email: 'x@test.example', type: 'sign-in', otp: '123456' })).status).toBe(404)
    const form = await authRoute.POST(
      new Request(`${BASE}/api/auth/email-otp/send-verification-otp`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE }, body: 'email=x%40test.example&type=sign-in' }),
    )
    expect(form.status).toBe(415)
  })

  it('never sends a code to a team member, and answers exactly as for anyone else', async () => {
    const email = 'otp-staff@test.example'
    const id = await staff(email)
    const before = sent.length
    now += OTP_LIMITS.cooldownMs + 1
    const res = await sendCode(email)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(sent.length).toBe(before)
    expect(await rows('SELECT id FROM auth_verification WHERE identifier LIKE ?', [`%-otp-${email}`])).toHaveLength(0)
    expect(await rows('SELECT id FROM auth_session WHERE userId = ?', [id])).toHaveLength(0)
  })
})

describe('sessions and profile', () => {
  it('lists, revokes one, revokes the others and signs out', async () => {
    const email = 'otp-sessions@test.example'
    const first = await signUp(email)
    await sendCode(email)
    const second = cookiesFrom(await post('/sign-in/email-otp', { email, otp: codeFor(email) }))
    now += OTP_LIMITS.cooldownMs + 1
    await sendCode(email)
    const third = cookiesFrom(await post('/sign-in/email-otp', { email, otp: codeFor(email) }))
    const list = await getAuth()!.api.listSessions({ headers: new Headers({ cookie: first }) })
    expect(list).toHaveLength(3)

    const secondToken = (await sessionOf(second))!.session.token
    expect((await post('/revoke-session', { token: secondToken }, first)).status).toBe(200)
    expect(await sessionOf(second)).toBeNull()
    expect(await sessionOf(third)).not.toBeNull()

    expect((await post('/revoke-other-sessions', {}, first)).status).toBe(200)
    expect(await sessionOf(third)).toBeNull()
    expect(await sessionOf(first)).not.toBeNull()

    expect((await post('/sign-out', {}, first)).status).toBe(200)
    expect(await sessionOf(first)).toBeNull()
  })

  it('lets a student rename themselves, and only themselves', async () => {
    const email = 'otp-rename@test.example'
    const cookie = await signUp(email)
    const user = (await sessionOf(cookie))!.user
    const call = (body: unknown) =>
      profileRoute.POST(new Request(`${BASE}/api/student/profile`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify(body) }))
    expect((await call({ action: 'rename', displayName: 'Too Early' })).status).toBe(403)
    expect((await call({ action: 'create', privacyAccepted: true, ageConfirmed: true, displayName: 'Asha Rao' })).status).toBe(200)
    expect((await call({ action: 'rename', displayName: '<script>' })).status).toBe(400)
    const ok = await call({ action: 'rename', displayName: '  Asha   Rao ', userId: 'someone-else' })
    expect(await ok.json()).toEqual({ ok: true, displayName: 'Asha Rao' })
    expect(await rows('SELECT display_name FROM student_profiles WHERE user_id = ?', [user.id])).toEqual([{ display_name: 'Asha Rao' }])
    const me = await profileRoute.GET(new Request(`${BASE}/api/student/profile`, { headers: { cookie } }))
    expect(await me.json()).toEqual({ displayName: 'Asha Rao', email, methods: [] })
  })
})

describe('privacy rights', () => {
  const studentCall = (route: { POST: (r: Request) => Promise<Response> }, path: string, cookie: string, body: unknown) =>
    route.POST(new Request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify(body) }))
  async function student(email: string) {
    const cookie = await signUp(email)
    expect((await studentCall(profileRoute, '/api/student/profile', cookie, { action: 'create', privacyAccepted: true, ageConfirmed: true, displayName: 'Asha Rao' })).status).toBe(200)
    return cookie
  }

  it('exports the student’s own data as a file, with no secrets in it', async () => {
    const email = 'rights-export@test.example'
    const cookie = await student(email)
    expect((await studentCall(conversationsRoute, '/api/student/conversations', cookie, { body: 'Which documents do I need for a master’s in Germany?', clientRequestId: randomUUID() })).status).toBeLessThan(300)
    const res = await accountRoute.GET(new Request(`${BASE}/api/student/account`, { headers: { cookie } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
    const text = await res.text()
    const data = JSON.parse(text)
    expect(data.account.email).toBe(email)
    expect(data.profile.privacyNoticeAccepted).toBe(PRIVACY_NOTICE_VERSION)
    expect(data.profile.ageConfirmedAt).toBeTruthy()
    expect(data.conversations[0].messages[0]).toMatchObject({ from: 'You', body: 'Which documents do I need for a master’s in Germany?' })
    expect(data.processors.length).toBeGreaterThan(0)
    const token = (await sessionOf(cookie))!.session.token
    expect(text).not.toContain(token)
    expect(text).not.toMatch(/"(password|token|accessToken|idToken|value)"|-otp-/i)
    // Signed out: nothing.
    expect((await accountRoute.GET(new Request(`${BASE}/api/student/account`))).status).toBe(401)
  })

  it('asks for consent again after a new notice, keeping export and deletion open meanwhile', async () => {
    const email = 'rights-consent@test.example'
    const cookie = await student(email)
    const user = (await sessionOf(cookie))!.user
    await db.query("UPDATE student_profiles SET privacy_notice_version = 'student-older' WHERE user_id = ?", [user.id])
    expect(await resolveStudentContext(new Headers({ cookie }))).toMatchObject({ state: 'needs_consent', acceptedVersion: 'student-older' })
    const chat = await conversationsRoute.GET(new Request(`${BASE}/api/student/conversations`, { headers: { cookie } }))
    expect(chat.status).toBe(403)
    expect(await chat.json()).toMatchObject({ state: 'needs_consent' })
    expect((await accountRoute.GET(new Request(`${BASE}/api/student/account`, { headers: { cookie } }))).status).toBe(200)
    expect((await studentCall(profileRoute, '/api/student/profile', cookie, { action: 'consent' })).status).toBe(400)
    expect(await (await studentCall(profileRoute, '/api/student/profile', cookie, { action: 'consent', privacyAccepted: true })).json()).toEqual({ ok: true, version: PRIVACY_NOTICE_VERSION })
    expect((await resolveStudentContext(new Headers({ cookie }))).state).toBe('ok')
    expect((await studentCall(profileRoute, '/api/student/profile', cookie, { action: 'consent', privacyAccepted: true })).status).toBe(409)

    // Withdrawal stays as easy while consent is pending.
    await db.query("UPDATE student_profiles SET privacy_notice_version = 'student-older' WHERE user_id = ?", [user.id])
    expect((await studentCall(accountRoute, '/api/student/account', cookie, { confirm: 'DELETE' })).status).toBe(200)
    expect(await rows('SELECT id FROM auth_user WHERE id = ?', [user.id])).toHaveLength(0)
  })

  it('budgets the unauthenticated 18+ confirmation before anything is written', async () => {
    resetRequestBuckets()
    for (let i = 0; i < AGE_CONFIRM_LIMITS.global.burst; i++) await confirmAge()
    const res = await ageRoute.POST(
      new Request(`${BASE}/api/student/age-confirmation`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ fullName: 'Synthetic Adult Student', ageConfirmed: true }) }),
    )
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    resetRequestBuckets()
  })
})

describe('passwordless sign-up and sign-in', () => {
  const onboard = (cookie: string, body: Record<string, unknown>) =>
    profileRoute.POST(new Request(`${BASE}/api/student/profile`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify({ action: 'create', privacyAccepted: true, ...body }) }))

  it('takes a new student from code to name, 18+ and consent, then signs them in again with a new code', async () => {
    const email = 'pl-flow@test.example'
    const cookie = await signUp(email)
    // Name, 18+ and consent are all required, and the name must be a real one.
    expect((await onboard(cookie, { displayName: 'Meera Iyer' })).status).toBe(400) // no 18+
    expect((await onboard(cookie, { ageConfirmed: true })).status).toBe(400) // no name
    expect((await onboard(cookie, { ageConfirmed: true, displayName: '<b>' })).status).toBe(400)
    expect((await onboard(cookie, { ageConfirmed: true, displayName: 'Meera Iyer', privacyAccepted: false })).status).toBe(400)
    expect((await onboard(cookie, { ageConfirmed: true, displayName: 'Meera Iyer' })).status).toBe(200)
    const [u] = await rows<{ id: string }>('SELECT id FROM auth_user WHERE email = ?', [email])
    expect(await rows('SELECT display_name FROM student_profiles WHERE user_id = ?', [u.id])).toEqual([{ display_name: 'Meera Iyer' }])
    expect(await rows("SELECT id FROM auth_account WHERE providerId = 'credential' AND userId = ?", [u.id])).toHaveLength(0)

    expect((await post('/sign-out', {}, cookie)).status).toBe(200)
    expect(await sessionOf(cookie)).toBeNull()
    // Signing in again: a new code, straight to the chat (no second onboarding).
    expect((await sendCode(email)).status).toBe(200)
    const again = await post('/sign-in/email-otp', { email, otp: codeFor(email) })
    expect(again.status).toBe(200)
    expect(await resolveStudentContext(new Headers({ cookie: cookiesFrom(again) }))).toMatchObject({ state: 'ok', student: { userId: u.id, displayName: 'Meera Iyer' } })
    expect(await rows('SELECT id FROM auth_user WHERE email = ?', [email])).toHaveLength(1)
  })

  it('has no password sign-up, reset or student password sign-in', async () => {
    expect((await post('/sign-up/email', { email: 'pl-direct@test.example', password: 'a-long-student-passphrase', name: 'Direct' })).status).toBe(404)
    expect((await post('/email-otp/request-password-reset', { email: 'x@test.example' })).status).toBe(404)
    expect((await post('/email-otp/reset-password', { email: 'x@test.example', otp: '123456', password: 'a-long-student-passphrase' })).status).toBe(404)
    // An older student account that still has a password hash keeps it, but cannot open a session with it.
    const email = 'pl-oldpw@test.example'
    const cookie = await signUp(email)
    expect((await onboard(cookie, { ageConfirmed: true, displayName: 'Old Password' })).status).toBe(200)
    const [u] = await rows<{ id: string }>('SELECT id FROM auth_user WHERE email = ?', [email])
    const hash = await (await getAuth()!.$context).password.hash('a-long-student-passphrase')
    await db.query("INSERT INTO auth_account (id, accountId, providerId, userId, password, updatedAt) VALUES (?, ?, 'credential', ?, ?, UTC_TIMESTAMP(3))", [randomUUID(), u.id, u.id, hash])
    await db.query('DELETE FROM auth_session WHERE userId = ?', [u.id])
    const res = await post('/sign-in/email', { email, password: 'a-long-student-passphrase' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await rows('SELECT id FROM auth_session WHERE userId = ?', [u.id])).toHaveLength(0)
    expect(await rows("SELECT id FROM auth_account WHERE providerId = 'credential' AND userId = ?", [u.id])).toHaveLength(1) // preserved
  })

  it('refuses an unverified account and a team account', async () => {
    const unverified = randomUUID()
    await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(3))', [unverified, 'Unverified', 'pl-unverified@test.example'])
    expect(await createStudentProfile(unverified, { ageConfirmed: true, privacyAccepted: true })).toMatchObject({ ok: false, status: 403 })
    const staffId = await staff('pl-staff@test.example')
    expect(await createStudentProfile(staffId, { ageConfirmed: true, privacyAccepted: true })).toMatchObject({ ok: false, status: 403 })
    expect(await rows('SELECT id FROM student_profiles WHERE user_id IN (?, ?)', [unverified, staffId])).toHaveLength(0)
  })

  it('keeps a student signed in for 30 days with an HttpOnly, SameSite=Lax session cookie', async () => {
    const email = 'pl-session@test.example'
    expect((await sendCode(email)).status).toBe(200)
    const res = await post('/sign-in/email-otp', { email, otp: codeFor(email) })
    const session = res.headers.getSetCookie().find((c) => c.includes('session_token='))!
    expect(session).toMatch(/;\s*HttpOnly/i)
    expect(session).toMatch(/;\s*SameSite=Lax/i)
    expect(session).toMatch(/Max-Age=2592000/)
    const token = (await sessionOf(cookiesFrom(res)))!.session.token
    const [row] = await rows<{ days: number }>('SELECT TIMESTAMPDIFF(DAY, createdAt, expiresAt) AS days FROM auth_session WHERE token = ?', [token])
    expect(Number(row.days)).toBe(30)
  })

  it('lets a student read only their own conversations', async () => {
    const a = await signUp('pl-iso-a@test.example')
    expect((await onboard(a, { ageConfirmed: true, displayName: 'Student A' })).status).toBe(200)
    const b = await signUp('pl-iso-b@test.example')
    expect((await onboard(b, { ageConfirmed: true, displayName: 'Student B' })).status).toBe(200)
    const start = (cookie: string, body: string) =>
      conversationsRoute.POST(new Request(`${BASE}/api/student/conversations`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify({ body, clientRequestId: randomUUID() }) }))
    expect((await start(a, 'Student A asks about Canada')).status).toBeLessThan(300)
    expect((await start(b, 'Student B asks about Germany')).status).toBeLessThan(300)
    const list = async (cookie: string) => (await (await conversationsRoute.GET(new Request(`${BASE}/api/student/conversations`, { headers: { cookie } }))).json()) as { conversations: { id: number }[] }
    const aIds = (await list(a)).conversations.map((c) => c.id)
    const bIds = (await list(b)).conversations.map((c) => c.id)
    expect(aIds).toHaveLength(1)
    expect(bIds).toHaveLength(1)
    const read = (cookie: string, id: number) => messagesRoute.GET(new Request(`${BASE}/api/student/conversations/${id}/messages`, { headers: { cookie } }), { params: Promise.resolve({ id: String(id) }) })
    expect((await read(a, aIds[0])).status).toBe(200)
    const other = await read(a, bIds[0])
    expect(other.status).toBe(404)
    expect(await other.text()).not.toContain('Germany')
  })
})

describe('account linking', () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

  async function google(person: { email: string; sub: string; verified?: boolean }) {
    const auth = getAuth()!
    const started = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ provider: 'google', callbackURL: '/chat', errorCallbackURL: '/auth', requestSignUp: false }),
      }),
    )
    const url = new URL(((await started.json()) as { url: string }).url)
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input instanceof Request ? input.url : input).startsWith('https://oauth2.googleapis.com/token')) return realFetch(input, init)
      const t = Math.floor(Date.now() / 1000)
      const idToken = `${b64({ alg: 'RS256' })}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: person.sub, email: person.email, email_verified: person.verified ?? true, name: 'Synthetic', iat: t, exp: t + 3600, nonce: url.searchParams.get('nonce') })}.sig`
      return Response.json({ access_token: 'a', id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile' })
    })
    const res = await auth.handler(new Request(`${BASE}/api/auth/callback/google?${new URLSearchParams({ state: url.searchParams.get('state')!, code: 'c' })}`, { headers: { cookie: cookiesFrom(started) } }))
    vi.unstubAllGlobals()
    return { location: new URL(res.headers.get('location') ?? '/', BASE), cookie: cookiesFrom(res) }
  }

  it('adds Google to an email-code account only when Google verified the same email', async () => {
    const email = 'link-student@test.example'
    await signUp(email)
    const unverified = await google({ email, sub: 'sub-unverified', verified: false })
    expect(unverified.location.searchParams.get('error')).toBeTruthy()
    expect(await rows("SELECT id FROM auth_account WHERE providerId = 'google' AND accountId = 'sub-unverified'")).toHaveLength(0)

    const verified = await google({ email, sub: 'sub-verified' })
    expect(verified.location.searchParams.get('error')).toBeNull()
    const [user] = await rows<{ id: string }>('SELECT id FROM auth_user WHERE email = ?', [email])
    expect(await rows("SELECT userId FROM auth_account WHERE providerId = 'google' AND accountId = 'sub-verified'")).toEqual([{ userId: user.id }])
    expect((await sessionOf(verified.cookie))?.user.id).toBe(user.id)
  })

  it('never links a provider to a team account, even with a verified email', async () => {
    const email = 'link-staff@test.example'
    const id = await staff(email)
    const out = await google({ email, sub: 'sub-staff' })
    expect(['account_not_linked', 'unable_to_link_account']).toContain(out.location.searchParams.get('error'))
    expect(await rows('SELECT id FROM auth_account WHERE userId = ?', [id])).toHaveLength(0)
    expect(await rows('SELECT id FROM auth_session WHERE userId = ?', [id])).toHaveLength(0)
  })
})
