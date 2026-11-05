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

/** A new student account made with an emailed code, as /age-confirm then the code form do. Returns the session cookie. */
async function signUp(email: string) {
  const age = await confirmAge()
  expect((await sendCode(email)).status).toBe(200)
  const res = await post('/sign-in/email-otp', { email, otp: codeFor(email) }, age)
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
  it('creates an account only after the 18+ confirmation, and stores no usable code', async () => {
    const email = 'otp-new@test.example'
    expect((await sendCode(email)).status).toBe(200)
    const code = codeFor(email)!
    expect(code).toMatch(/^\d{6}$/)
    // HMAC with the server secret: neither the code nor its plain SHA-256 is in the database.
    const [stored] = await rows<{ value: string }>('SELECT value FROM auth_verification WHERE identifier = ?', [`sign-in-otp-${email}`])
    expect(stored.value).not.toContain(code)
    // No confirmation: nothing is created.
    const refused = await post('/sign-in/email-otp', { email, otp: code })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ code: 'FAILED_TO_CREATE_USER' })
    expect(await rows('SELECT id FROM auth_user WHERE email = ?', [email])).toHaveLength(0)
    now += OTP_LIMITS.cooldownMs + 1

    const cookie = await signUp(email)
    const [user] = await rows<{ id: string; emailVerified: number }>('SELECT id, emailVerified FROM auth_user WHERE email = ?', [email])
    expect(user.emailVerified).toBe(1)
    expect((await sessionOf(cookie))?.user.email).toBe(email)
    // No team role, no profile yet: the 18+/privacy step comes next, and it is allowed.
    expect(await canStartStudentProfile(user.id)).toBe(true)
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
    for (const type of ['sign-in', 'forget-password']) {
      now += OTP_LIMITS.cooldownMs + 1
      const res = await sendCode(email, type)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    }
    expect(sent.length).toBe(before)
    expect(await rows('SELECT id FROM auth_verification WHERE identifier LIKE ?', [`%-otp-${email}`])).toHaveLength(0)
    expect(await rows('SELECT id FROM auth_session WHERE userId = ?', [id])).toHaveLength(0)
  })

  it('resets a student password with a code, signing out every device', async () => {
    const email = 'otp-reset@test.example'
    const cookie = await signUp(email)
    expect((await post('/email-otp/request-password-reset', { email })).status).toBe(200)
    const code = codeFor(email)!
    expect((await post('/email-otp/reset-password', { email, otp: code, password: 'short' })).status).toBe(400)
    expect((await post('/email-otp/reset-password', { email, otp: code, password: 'a-long-new-passphrase' })).status).toBe(200)
    expect(await sessionOf(cookie)).toBeNull()
    expect((await post('/email-otp/reset-password', { email, otp: code, password: 'another-long-passphrase' })).status).toBe(400)
    expect((await post('/sign-in/email', { email, password: 'a-long-new-passphrase' })).status).toBe(200)
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
    expect((await call({ action: 'create', privacyAccepted: true })).status).toBe(200)
    expect((await call({ action: 'rename', displayName: '<script>' })).status).toBe(400)
    const ok = await call({ action: 'rename', displayName: '  Asha   Rao ', userId: 'someone-else' })
    expect(await ok.json()).toEqual({ ok: true, displayName: 'Asha Rao' })
    expect(await rows('SELECT display_name FROM student_profiles WHERE user_id = ?', [user.id])).toEqual([{ display_name: 'Asha Rao' }])
    const me = await profileRoute.GET(new Request(`${BASE}/api/student/profile`, { headers: { cookie } }))
    expect(await me.json()).toEqual({ displayName: 'Asha Rao', email, methods: [] })
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
