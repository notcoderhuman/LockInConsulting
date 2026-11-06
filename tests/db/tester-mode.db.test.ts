// Pre-launch tester mode (STUDENT_TEST_EMAILS): only listed addresses can get a code, an account, a
// password, a session and the chat, while public sign-up stays closed. Real route handlers, Better
// Auth and a real database; mail is captured in memory. Run with `pnpm test:db`.
import { randomUUID } from 'node:crypto'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) } }))

const BASE = 'http://localhost:3000'
const LISTED = 'tester@test.example'
const PASSWORD = 'a-long-tester-passphrase'
const STAFF = 'staff-tester@test.example'
const ENV = {
  BETTER_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'),
  BETTER_AUTH_URL: BASE,
  STUDENT_ACCOUNTS_ENABLED: 'true',
  // Public self sign-up stays OFF: tester mode must work without it.
  STUDENT_SELF_SIGNUP_ENABLED: 'false',
  STUDENT_TEST_EMAILS: ` ${LISTED.toUpperCase()} , Second@Test.example,not-an-email,${STAFF}`,
  SMTP_HOST: 'smtp.invalid',
  SMTP_USER: 'synthetic',
  SMTP_PASSWORD: 'synthetic-not-real',
  MAIL_FROM: 'LockIn <no-reply@test.example>',
}
Object.assign(process.env, ENV)

const { getAuth } = await import('@/lib/auth')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
const { mailer } = await import('@/lib/mail')
const { clock, resetRequestBuckets } = await import('@/lib/auth-throttle')
const { OTP_LIMITS } = await import('@/lib/auth-otp')
const { newAccountsAllowed, studentEmailAllowed, studentSignUpOpen, testerEmails, testerMode } = await import('@/lib/identity/policy')
const { canStartStudentProfile } = await import('@/lib/student/onboarding')
const { resolveStudentContext } = await import('@/lib/student/access')
const { resolveAdminContext } = await import('@/lib/admin/access')
const authRoute = await import('@/app/api/auth/[...all]/route')
const ageRoute = await import('@/app/api/student/age-confirmation/route')
const profileRoute = await import('@/app/api/student/profile/route')
const conversationsRoute = await import('@/app/api/student/conversations/route')
const { runAdminCli } = await import('../../scripts/admin-user.mjs')

// Each send moves time past the per-email resend cooldown, so the tests exercise tester mode, not that limit.
let now = Date.UTC(2026, 10, 6, 9)
clock.now = () => now

let server: TestDatabase
let db: Connection
const sent: { to: string; text: string }[] = []
const rows = async <R = RowDataPacket>(sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0] as R[]

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  process.env.DATABASE_URL = server.url
  mailer.send = async (m) => {
    sent.push(m)
  }
}, 240_000)

beforeEach(async () => {
  Object.assign(process.env, ENV)
  resetRequestBuckets()
  await db.query('DELETE FROM auth_rate_limit')
})

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

const cookiesFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const post = (path: string, body: unknown, cookie = '') => {
  if (/send-verification-otp|request-password-reset/.test(path)) now += OTP_LIMITS.cooldownMs + 1
  return authRoute.POST(new Request(`${BASE}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify(body) }))
}
const sendCode = (email: string, type = 'sign-in') => post('/email-otp/send-verification-otp', { email, type })
const codeFor = (email: string) => sent.filter((m) => m.to === email.toLowerCase()).at(-1)?.text.match(/\b(\d{6})\b/)?.[1]
const onboard = (cookie: string, body: Record<string, unknown>) =>
  profileRoute.POST(new Request(`${BASE}/api/student/profile`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify({ action: 'create', privacyAccepted: true, ...body }) }))

async function confirmAge() {
  const res = await ageRoute.POST(
    new Request(`${BASE}/api/student/age-confirmation`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ fullName: 'Synthetic Tester', ageConfirmed: true }) }),
  )
  return { status: res.status, cookie: cookiesFrom(res) }
}

/** The full sign-up as the tester entry point drives it. Returns the session cookie, or '' when refused. */
async function signUp(email: string) {
  const age = await confirmAge()
  await sendCode(email)
  const code = codeFor(email)
  if (!code) return ''
  const res = await post('/sign-in/email-otp', { email, otp: code }, age.cookie)
  return res.ok ? cookiesFrom(res) : ''
}

describe('pre-launch tester mode', () => {
  it('parses the allowlist and keeps the public closed', () => {
    expect(testerEmails()).toEqual([LISTED, 'second@test.example', STAFF])
    expect(testerMode()).toBe(true)
    expect(studentSignUpOpen()).toBe(false) // public self sign-up is off
    expect(newAccountsAllowed()).toBe(true) // only because of tester mode
    expect(studentEmailAllowed('Tester@Test.Example')).toBe(true)
    expect(studentEmailAllowed('someone@test.example')).toBe(false)
    // Off without the student area, without addresses, or once the notice is ready (public rules apply).
    expect(testerMode({ ...ENV, STUDENT_ACCOUNTS_ENABLED: 'false' })).toBe(false)
    expect(testerMode({ ...ENV, STUDENT_TEST_EMAILS: ' , not-an-email' })).toBe(false)
    expect(testerMode(ENV, true)).toBe(false)
    expect(studentEmailAllowed('someone@test.example', ENV, true)).toBe(true)
    // Production with the notice not ready: still nobody from the public.
    const prod = { ...ENV, NODE_ENV: 'production', STUDENT_SELF_SIGNUP_ENABLED: 'true', STUDENT_PRIVACY_NOTICE_URL: '/privacy' }
    expect(studentSignUpOpen(prod)).toBe(false)
    expect(studentEmailAllowed('someone@test.example', prod)).toBe(false)
  })

  it('lets a listed address register, set a password, sign in, chat, sign out and recover', async () => {
    const cookie = await signUp(LISTED)
    expect(cookie).toMatch(/session_token=/)
    expect((await onboard(cookie, { password: PASSWORD })).status).toBe(200)
    expect((await resolveStudentContext(new Headers({ cookie }))).state).toBe('ok')
    const chat = await conversationsRoute.POST(
      new Request(`${BASE}/api/student/conversations`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify({ body: 'Tester question about Canada', clientRequestId: randomUUID() }) }),
    )
    expect(chat.status).toBeLessThan(300)
    expect((await post('/sign-out', {}, cookie)).status).toBe(200)
    const signedIn = await post('/sign-in/email', { email: LISTED, password: PASSWORD })
    expect(signedIn.status).toBe(200)
    expect((await resolveStudentContext(new Headers({ cookie: cookiesFrom(signedIn) }))).state).toBe('ok')
    // Recovery: a reset code goes to the listed address and works.
    expect((await post('/email-otp/request-password-reset', { email: LISTED })).status).toBe(200)
    expect((await post('/email-otp/reset-password', { email: LISTED, otp: codeFor(LISTED), password: 'another-long-passphrase' })).status).toBe(200)
    expect((await post('/sign-in/email', { email: LISTED, password: 'another-long-passphrase' })).status).toBe(200)
  })

  it('matches the list case-insensitively', async () => {
    const cookie = await signUp('SECOND@test.EXAMPLE')
    expect(cookie).toMatch(/session_token=/)
    expect(await rows('SELECT email FROM auth_user WHERE email = ?', ['second@test.example'])).toHaveLength(1)
  })

  it('sends an unlisted address nothing, creates nothing, and answers exactly as for a listed one', async () => {
    const before = sent.length
    const unlisted = await sendCode('outsider@test.example')
    const listed = await sendCode('second@test.example') // an existing, listed account
    expect(unlisted.status).toBe(listed.status)
    expect(await unlisted.text()).toBe(await listed.text())
    expect(unlisted.headers.get('content-type')).toBe(listed.headers.get('content-type'))
    expect(sent.slice(before).map((m) => m.to)).toEqual(['second@test.example'])
    expect(await rows('SELECT id FROM auth_verification WHERE identifier LIKE ?', ['%outsider@test.example'])).toHaveLength(0)
    // Any code they guess fails the same way a wrong code does, and no account appears.
    const age = await confirmAge()
    expect(age.status).toBe(200) // the 18+ step grants nothing by itself
    const guess = await post('/sign-in/email-otp', { email: 'outsider@test.example', otp: '123456' }, age.cookie)
    expect(guess.status).toBe(400)
    expect(await rows('SELECT id FROM auth_user WHERE email = ?', ['outsider@test.example'])).toHaveLength(0)
    // Password reset requests get the same answer and no email either.
    const reset = await post('/email-otp/request-password-reset', { email: 'outsider@test.example' })
    expect(reset.status).toBe(200)
    expect(sent.slice(before).map((m) => m.to)).toEqual(['second@test.example'])
  })

  it('locks out an unlisted student who already had an account, by any sign-in method', async () => {
    // Created while tester mode was off and public sign-up on (synthetic), then the list is set.
    const id = randomUUID()
    await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3))', [id, 'Early Student', 'early@test.example'])
    const hash = await (await getAuth()!.$context).password.hash(PASSWORD)
    await db.query("INSERT INTO auth_account (id, accountId, providerId, userId, password, updatedAt) VALUES (?, ?, 'credential', ?, ?, UTC_TIMESTAMP(3))", [randomUUID(), id, id, hash])
    await db.query("INSERT INTO student_profiles (user_id, display_name, status, privacy_notice_version) VALUES (?, 'Early Student', 'active', NULL)", [id])
    const res = await post('/sign-in/email', { email: 'early@test.example', password: PASSWORD })
    expect(res.status).not.toBe(200)
    expect(await rows('SELECT id FROM auth_session WHERE userId = ?', [id])).toHaveLength(0)
    expect(await canStartStudentProfile(id)).toBe(false)
    // Without tester mode (list removed) the same account works again.
    process.env.STUDENT_TEST_EMAILS = ''
    const later = await post('/sign-in/email', { email: 'early@test.example', password: PASSWORD })
    expect(later.status).toBe(200)
    expect((await resolveStudentContext(new Headers({ cookie: cookiesFrom(later) }))).state).toBe('ok')
    // ...and is shown the closed area again as soon as the list is back, without signing in.
    process.env.STUDENT_TEST_EMAILS = ENV.STUDENT_TEST_EMAILS
    expect((await resolveStudentContext(new Headers({ cookie: cookiesFrom(later) }))).state).toBe('disabled')
  })

  it('never lets staff in as a tester, even when listed, and leaves staff sign-in alone', async () => {
    const staff = (await runAdminCli(['create', '--email', STAFF, '--name', 'Synthetic Staff', '--role', 'editor'], {
      env: process.env,
      readPassword: async () => PASSWORD,
      log: () => {},
      actor: 'cli:test',
    })) as { userId: string }
    const before = sent.length
    expect((await sendCode(STAFF)).status).toBe(200)
    expect((await post('/email-otp/request-password-reset', { email: STAFF })).status).toBe(200)
    expect(sent.length).toBe(before)
    await db.query('UPDATE auth_user SET emailVerified = 1 WHERE id = ?', [staff.userId])
    expect(await canStartStudentProfile(staff.userId)).toBe(false)
    const admin = await post('/sign-in/email', { email: STAFF, password: PASSWORD })
    expect(admin.status).toBe(200)
    expect((await resolveAdminContext(new Headers({ cookie: cookiesFrom(admin) }))).state).toBe('ok')
    expect(await rows('SELECT id FROM student_profiles WHERE user_id = ?', [staff.userId])).toHaveLength(0)
  })

  it('keeps everything closed once the list is empty and public sign-up is off', async () => {
    process.env.STUDENT_TEST_EMAILS = ''
    expect(newAccountsAllowed()).toBe(false)
    expect((await confirmAge()).status).toBe(503)
  })
})
