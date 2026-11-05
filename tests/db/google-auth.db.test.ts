// Google sign-in for students through the real Better Auth handler and a real database. Offline:
// Google's token endpoint is stubbed with a synthetic ID token, so no request leaves this machine
// and no real credentials exist. Run with `pnpm test:db`.
import { createHash, randomUUID } from 'node:crypto'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) } }))

const { createAuth } = await import('@/lib/auth')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
const { getIdentityProviderStatus } = await import('@/lib/identity/policy')
const { oauthErrorMessage } = await import('@/lib/identity/oauth-errors')
const { canStartStudentProfile } = await import('@/lib/student/onboarding')
const authRoute = await import('@/app/api/auth/[...all]/route')
const { resolveAdminContext } = await import('@/lib/admin/access')
const { resolveStudentContext } = await import('@/lib/student/access')
const { runAdminCli } = await import('../../scripts/admin-user.mjs')
const ageRoute = await import('@/app/api/student/age-confirmation/route')
const { createStudentProfile, discardUnfinishedAccount } = await import('@/lib/student/onboarding')
const { normalizeFullName } = await import('@/lib/student/age-attestation')

const BASE = 'http://localhost:3000'
const CLIENT_ID = 'synthetic-client-id.apps.googleusercontent.com'
const SECRET_VALUE = 'synthetic-client-secret-not-real'
const ENV = {
  BETTER_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'),
  BETTER_AUTH_URL: BASE,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: SECRET_VALUE,
  STUDENT_ACCOUNTS_ENABLED: 'true',
}

let server: TestDatabase
let db: Connection
const rows = async <R = RowDataPacket>(sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0] as R[]

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  Object.assign(process.env, { DATABASE_URL: server.url }, ENV)
}, 240_000)

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.STUDENT_SELF_SIGNUP_ENABLED
  Object.assign(process.env, ENV)
  delete process.env.ADMIN_DISABLED
})

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const cookiesFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

/** /age-confirm's "Confirm and continue": returns the 18+ token cookie (name=value) it sets. */
async function confirmAge(body: unknown = { fullName: 'Synthetic Adult Student', ageConfirmed: true }, cookie = '') {
  const res = await ageRoute.POST(
    new Request(`${BASE}/api/student/age-confirmation`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify(body) }),
  )
  return { res, cookie: cookiesFrom(res), setCookie: res.headers.get('set-cookie') ?? '' }
}

/** Starts the flow exactly as the "Continue with Google" button does (optionally after /age-confirm). */
async function start(auth: ReturnType<typeof createAuth>, requestSignUp: boolean, ageCookie = '') {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ provider: 'google', callbackURL: '/chat', errorCallbackURL: '/auth', requestSignUp }),
    }),
  )
  const body = (await res.json()) as { url?: string; code?: string }
  return { res, body, url: body.url ? new URL(body.url) : null, cookies: [cookiesFrom(res), ageCookie].filter(Boolean).join('; ') }
}

/** Google redirecting back; the token endpoint is stubbed with this person's synthetic ID token. */
async function callback(auth: ReturnType<typeof createAuth>, flow: Awaited<ReturnType<typeof start>>, person: { email: string; sub: string; verified?: boolean } | null, query: Record<string, string> = {}) {
  const nonce = flow.url?.searchParams.get('nonce') ?? undefined
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://oauth2.googleapis.com/token')) return realFetch(input, init)
    if (!person) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } })
    const now = Math.floor(Date.now() / 1000)
    const idToken = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: person.sub, email: person.email, email_verified: person.verified ?? true, name: 'Synthetic Google Student', iat: now, exp: now + 3600, nonce })}.sig`
    return new Response(JSON.stringify({ access_token: 'synthetic-access', id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const params = new URLSearchParams({ state: flow.url?.searchParams.get('state') ?? 'missing', ...(query.error ? {} : { code: 'synthetic-code' }), ...query })
  const res = await auth.handler(new Request(`${BASE}/api/auth/callback/google?${params}`, { headers: { cookie: flow.cookies } }))
  return { res, location: res.headers.get('location') ?? '', cookies: cookiesFrom(res) }
}

const errorOf = (location: string) => new URL(location, BASE).searchParams.get('error')

describe('Google sign-in (students only)', () => {
  it('is unavailable without both credentials, and a failed callback lands on a readable page', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET
    expect(getIdentityProviderStatus().find((p) => p.id === 'google')?.state).toBe('not_configured')
    const flow = await start(createAuth(), true)
    expect(flow.res.status).toBe(404)
    expect(flow.url).toBeNull()

    process.env.ADMIN_DISABLED = 'true' // auth not constructible, e.g. misconfigured or database settings missing
    const res = await authRoute.GET(new Request(`${BASE}/api/auth/callback/google?code=x&state=y`))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${BASE}/auth?error=unavailable`)
    expect(oauthErrorMessage('unavailable')).toMatch(/temporarily unavailable/)
  })

  it('cannot be started while student accounts are closed, even with both credentials set', async () => {
    delete process.env.STUDENT_ACCOUNTS_ENABLED
    expect(getIdentityProviderStatus().find((p) => p.id === 'google')?.state).toBe('closed')
    const flow = await start(createAuth(), false)
    expect(flow.res.status).toBe(404)
    expect(flow.url).toBeNull()
  })

  it('starts a PKCE + state redirect to Google without exposing the secret', async () => {
    expect(getIdentityProviderStatus().find((p) => p.id === 'google')?.state).toBe('available')
    const flow = await start(createAuth(), false)
    expect(flow.url?.origin).toBe('https://accounts.google.com')
    expect(flow.url?.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(flow.url?.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/callback/google`)
    expect(flow.url?.searchParams.get('state')).toBeTruthy()
    expect(flow.url?.searchParams.get('code_challenge_method')).toBe('S256')
    expect(flow.url?.searchParams.get('prompt')).toBe('select_account')
    expect(JSON.stringify(flow.body) + flow.cookies).not.toContain(SECRET_VALUE)
    // Identity scopes only, no folded-in earlier grants, and the callback follows BETTER_AUTH_URL.
    expect(flow.url?.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'profile'])
    expect(flow.url?.searchParams.has('include_granted_scopes')).toBe(false)
    expect(flow.url?.searchParams.has('access_type')).toBe(false) // no offline refresh token
    expect(flow.url?.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/callback/google`)
    const staging = await start(createAuth('https://staging.lockin.example'), false)
    expect(staging.url?.searchParams.get('redirect_uri')).toBe('https://staging.lockin.example/api/auth/callback/google')
  })

  it('refuses a sign-in request that asks Google for extra scopes', async () => {
    for (const body of [{ provider: 'google', callbackURL: '/chat', scopes: ['https://www.googleapis.com/auth/drive'] }, { provider: 'google', callbackURL: '/chat', scopes: [] }]) {
      const res = await authRoute.POST(
        new Request(`${BASE}/api/auth/sign-in/social`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify(body) }),
      )
      expect(res.status).toBe(400)
      expect(await res.text()).not.toMatch(/googleapis|drive/)
    }
    const ok = await authRoute.POST(
      new Request(`${BASE}/api/auth/sign-in/social`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ provider: 'google', callbackURL: '/chat' }) }),
    )
    expect(ok.status).toBe(200)
  })

  it('handles cancellation and a tampered or expired state with clear messages', async () => {
    const auth = createAuth()
    const cancelled = await callback(auth, await start(auth, false), null, { error: 'access_denied' })
    expect(cancelled.res.status).toBe(302)
    expect(cancelled.location).toMatch(/\/auth\?error=access_denied/)
    expect(oauthErrorMessage(errorOf(cancelled.location))).toMatch(/cancelled/)

    const flow = await start(auth, false)
    const tampered = await callback(auth, { ...flow, url: new URL(`https://accounts.google.com/?state=${randomUUID()}`) }, { email: 'x@test.example', sub: 'x' })
    expect(tampered.res.status).toBe(302)
    expect(oauthErrorMessage(errorOf(tampered.location))).toMatch(/expired or was interrupted|didn’t complete/)
    expect(await rows('SELECT id FROM auth_user WHERE email = ?', ['x@test.example'])).toHaveLength(0)

    const badCode = await callback(auth, await start(auth, false), null)
    expect(badCode.res.status).toBe(302)
    expect(errorOf(badCode.location)).toBeTruthy()
  })

  it('creates no account while self sign-up is closed', async () => {
    const auth = createAuth()
    const out = await callback(auth, await start(auth, true), { email: 'closed@test.example', sub: 'sub-closed' })
    expect(errorOf(out.location)).toBe('signup_disabled')
    expect(oauthErrorMessage('signup_disabled')).toMatch(/aren’t open yet/)
    expect(await rows('SELECT id FROM auth_user WHERE email = ?', ['closed@test.example'])).toHaveLength(0)
  })

  it('signs a new person up only when asked and open, with no profile or team role until they confirm', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const auth = createAuth()
    // No implicit sign-up: the button must ask for it.
    const implicit = await callback(auth, await start(auth, false), { email: 'new@test.example', sub: 'sub-new' })
    expect(errorOf(implicit.location)).toBe('signup_disabled')

    // Unverified email: refused BEFORE Better Auth inserts the user (it would otherwise leave a row),
    // and the age confirmation used for the attempt is spent.
    const unverifiedAge = await confirmAge()
    const unverified = await callback(auth, await start(auth, true, unverifiedAge.cookie), { email: 'unverified@test.example', sub: 'sub-unverified', verified: false })
    expect(errorOf(unverified.location)).toBe('unable_to_create_user')
    expect(await rows('SELECT id FROM auth_user WHERE email = ?', ['unverified@test.example'])).toHaveLength(0)
    const retry = await callback(auth, await start(auth, true, unverifiedAge.cookie), { email: 'unverified@test.example', sub: 'sub-unverified' })
    expect(errorOf(retry.location)).toBe('unable_to_create_user')
    expect(await rows('SELECT id FROM auth_user WHERE email = ?', ['unverified@test.example'])).toHaveLength(0)

    const ok = await callback(auth, await start(auth, true, (await confirmAge()).cookie), { email: 'new@test.example', sub: 'sub-new' })
    expect(ok.res.status).toBe(302)
    expect(ok.location).toMatch(/\/chat$/)
    const [user] = await rows<{ id: string }>('SELECT id FROM auth_user WHERE email = ?', ['new@test.example'])
    expect(await rows("SELECT id FROM auth_account WHERE userId = ? AND providerId = 'google'", [user.id])).toHaveLength(1)
    expect(await rows('SELECT id FROM student_profiles WHERE user_id = ?', [user.id])).toHaveLength(0)
    expect(await rows('SELECT user_id FROM admin_members WHERE user_id = ?', [user.id])).toHaveLength(0)
    expect(await canStartStudentProfile(user.id)).toBe(true)
    const session = await auth.api.getSession({ headers: new Headers({ cookie: ok.cookies }) })
    expect(session?.user.id).toBe(user.id)

    // A returning Google student still signs in after sign-up closes again.
    delete process.env.STUDENT_SELF_SIGNUP_ENABLED
    const closedAuth = createAuth()
    const back = await callback(closedAuth, await start(closedAuth, false), { email: 'new@test.example', sub: 'sub-new' })
    expect(back.location).toMatch(/\/chat$/)
  })

  it('never turns a Google account into staff: the CLI refuses it and /admin refuses it even if a role row appears', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const auth = createAuth()
    const ok = await callback(auth, await start(auth, true, (await confirmAge()).cookie), { email: 'would-be-staff@test.example', sub: 'sub-staff' })
    const [user] = await rows<{ id: string }>('SELECT id FROM auth_user WHERE email = ?', ['would-be-staff@test.example'])
    const cli = (args: string[]) => runAdminCli(args, { env: process.env, readPassword: async () => 'correct horse battery staple', log: () => {}, actor: 'cli:test' })
    await expect(cli(['grant', '--email', 'would-be-staff@test.example', '--role', 'owner'])).rejects.toThrow(/signs in with Google/)
    await expect(cli(['create', '--email', 'would-be-staff@test.example', '--role', 'owner', '--name', 'X'])).rejects.toThrow(/already has an account/)
    expect(await rows('SELECT user_id FROM admin_members WHERE user_id = ?', [user.id])).toHaveLength(0)

    // Defence in depth: a role row inserted by hand still does not open /admin to a Google session.
    await db.query("INSERT INTO admin_members (user_id, role, status, granted_by) VALUES (?, 'owner', 'active', 'manual-test')", [user.id])
    expect(await resolveAdminContext(new Headers({ cookie: ok.cookies }))).toMatchObject({ state: 'forbidden' })
    // …and a password-provisioned staff account is unaffected.
    const staff = await cli(['create', '--email', 'real-staff@test.example', '--role', 'editor', '--name', 'Synthetic Staff'])
    const signIn = (await createAuth().api.signInEmail({ body: { email: 'real-staff@test.example', password: 'correct horse battery staple' }, asResponse: true })) as Response
    expect(await resolveAdminContext(new Headers({ cookie: cookiesFrom(signIn) }))).toMatchObject({ state: 'ok', actor: { userId: (staff as { userId: string }).userId, role: 'editor' } })
  })

  it('keeps student access closed when the student area is off, even after a Google sign-in', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const auth = createAuth()
    const ok = await callback(auth, await start(auth, true, (await confirmAge()).cookie), { email: 'area-closed@test.example', sub: 'sub-closed-area' })
    delete process.env.STUDENT_ACCOUNTS_ENABLED
    expect(await resolveStudentContext(new Headers({ cookie: ok.cookies }))).toEqual({ state: 'disabled' })
    const [user] = await rows<{ id: string }>('SELECT id FROM auth_user WHERE email = ?', ['area-closed@test.example'])
    expect(await canStartStudentProfile(user.id)).toBe(false)
  })

  it('never lets Google into an existing password account, such as a team member’s', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const staffId = randomUUID()
    await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3))', [staffId, 'Synthetic Owner', 'owner-google@test.example'])
    await db.query("INSERT INTO admin_members (user_id, role, status, granted_by) VALUES (?, 'owner', 'active', 'cli:test')", [staffId])
    const auth = createAuth()
    const out = await callback(auth, await start(auth, true), { email: 'owner-google@test.example', sub: 'sub-owner' })
    // Refused by Better Auth (unverified local email) or by the staff guard in lib/auth.ts.
    expect(['account_not_linked', 'unable_to_link_account']).toContain(errorOf(out.location))
    expect(oauthErrorMessage('account_not_linked')).toMatch(/email and password/)
    expect(await rows('SELECT id FROM auth_account WHERE userId = ?', [staffId])).toHaveLength(0)
    expect(out.cookies).not.toMatch(/session_token=[^;]+/)
  })
})

describe('18+ confirmation before a new student account (D-045)', () => {
  const tokenHash = (cookie: string) => createHash('sha256').update(cookie.split('=')[1]).digest('hex')
  const signUp = async (email: string, ageCookie = '') => {
    const auth = createAuth()
    return callback(auth, await start(auth, true, ageCookie), { email, sub: `sub-${email}` })
  }
  const users = (email: string) => rows<{ id: string }>('SELECT id FROM auth_user WHERE email = ?', [email])
  const cancel = (cookie: string) =>
    ageRoute.DELETE(new Request(`${BASE}/api/student/age-confirmation`, { method: 'DELETE', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: '{}' }))

  it('records a confirmation only for a ticked box, from this site, while sign-up is open', async () => {
    expect((await confirmAge()).res.status).toBe(503) // sign-up closed
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const fullName = 'Synthetic Adult Student'
    for (const body of [{}, { fullName }, { fullName, ageConfirmed: false }, { fullName, ageConfirmed: 'true' }, { fullName, ageConfirmed: 1 }, { ageConfirmed: true }, { fullName: ' ', ageConfirmed: true }, { fullName: '<script>', ageConfirmed: true }])
      expect((await confirmAge(body)).res.status, JSON.stringify(body)).toBe(400)
    const crossSite = await ageRoute.POST(
      new Request(`${BASE}/api/student/age-confirmation`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"ageConfirmed":true}' }),
    )
    expect(crossSite.status).toBe(403)
    const ok = await confirmAge()
    expect(ok.res.status).toBe(200)
    // Short-lived, HttpOnly, Lax (sent on Google's top-level redirect back), random; only its hash is stored.
    expect(ok.setCookie).toMatch(/^lockin_age=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=900; HttpOnly; SameSite=Lax$/)
    const [row] = await rows<{ token_sha256: string; policy_version: string; user_id: string | null }>(
      'SELECT token_sha256, policy_version, user_id FROM student_age_attestations WHERE token_sha256 = ?',
      [tokenHash(ok.cookie)],
    )
    expect(row).toMatchObject({ policy_version: 'student-age-2026-10', user_id: null })
    await cancel(ok.cookie) // nothing about this person is kept once they back out
    expect(await rows('SELECT full_name FROM student_age_attestations WHERE token_sha256 = ?', [tokenHash(ok.cookie)])).toEqual([{ full_name: null }])
    expect(await rows('SELECT id FROM student_age_attestations WHERE token_sha256 = ?', [ok.cookie.split('=')[1]])).toHaveLength(0)
  })

  it('refuses a direct Google sign-up with no confirmation, a forged token or a client-side flag', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    for (const [i, cookie] of ['', 'lockin_age=' + 'A'.repeat(43), 'lockin_age=true', 'age_confirmed=true'].entries()) {
      const out = await signUp(`bypass${i}@test.example`, cookie)
      expect(errorOf(out.location), cookie).toBe('unable_to_create_user')
      expect(await users(`bypass${i}@test.example`)).toHaveLength(0)
    }
    expect(oauthErrorMessage('unable_to_create_user')).toMatch(/confirm that you’re 18 or older/)
  })

  it('creates the account with a valid confirmation, spends it, and records it on the profile', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const { cookie } = await confirmAge()
    const out = await signUp('adult@test.example', cookie)
    expect(out.location).toMatch(/\/chat$/)
    expect(out.res.headers.getSetCookie().some((c) => /^lockin_age=;/.test(c) && /Max-Age=0/i.test(c))).toBe(true) // cleared
    const [user] = await users('adult@test.example')
    const [att] = await rows<{ user_id: string; consumed_at: string | null; confirmed_at: string }>(
      'SELECT user_id, consumed_at, confirmed_at FROM student_age_attestations WHERE token_sha256 = ?',
      [tokenHash(cookie)],
    )
    expect(att.user_id).toBe(user.id)
    expect(att.consumed_at).not.toBeNull()
    // The privacy acknowledgement is still required; the age was attested before the account existed.
    expect(await createStudentProfile(user.id, { privacyAccepted: false })).toMatchObject({ ok: false, status: 400 })
    expect(await createStudentProfile(user.id, { privacyAccepted: true })).toEqual({ ok: true })
    const [profile] = await rows<{ age_confirmed_at: string; display_name: string }>('SELECT age_confirmed_at, display_name FROM student_profiles WHERE user_id = ?', [user.id])
    expect(String(profile.age_confirmed_at)).toBe(String(att.confirmed_at))
    // The name they typed, not Google's, and it no longer sits on the attestation.
    expect(profile.display_name).toBe('Synthetic Adult Student')
    expect(await rows('SELECT full_name FROM student_age_attestations WHERE user_id = ?', [user.id])).toEqual([{ full_name: null }])

    // Reused: the same token cannot create a second account.
    expect(errorOf((await signUp('second-person@test.example', cookie)).location)).toBe('unable_to_create_user')
    expect(await users('second-person@test.example')).toHaveLength(0)
  })

  it('tidies a full name and refuses what cannot be one, in any script', () => {
    expect(normalizeFullName('  Asha   Rao ')).toBe('Asha Rao')
    for (const name of ['आशा राव', 'José O’Neil', 'Mary-Jane St. Clair', 'محمد علي', 'Müller']) expect(normalizeFullName(name), name).toBe(name)
    for (const bad of [undefined, null, 7, '', ' ', 'A', '12345', '<b>x</b>', 'a@b.example', 'https://x.example', 'x'.repeat(121)]) expect(normalizeFullName(bad), String(bad)).toBeNull()
  })

  it('removes the name with an unfinished sign-in discarded at the privacy step', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const { cookie } = await confirmAge({ fullName: 'Synthetic Quitter', ageConfirmed: true })
    await signUp('quitter@test.example', cookie)
    const [user] = await users('quitter@test.example')
    expect(await discardUnfinishedAccount(user.id)).toEqual({ ok: true })
    expect(await users('quitter@test.example')).toHaveLength(0)
    expect(await rows('SELECT user_id, full_name FROM student_age_attestations WHERE token_sha256 = ?', [tokenHash(cookie)])).toEqual([{ user_id: null, full_name: null }])
  })

  it('refuses an expired or cancelled confirmation, and a new confirmation replaces the old one', async () => {
    process.env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
    const expired = await confirmAge()
    await db.query('UPDATE student_age_attestations SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE token_sha256 = ?', [tokenHash(expired.cookie)])
    expect(errorOf((await signUp('late@test.example', expired.cookie)).location)).toBe('unable_to_create_user')

    const cancelled = await confirmAge()
    expect((await cancel(cancelled.cookie)).headers.get('set-cookie')).toMatch(/^lockin_age=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax$/)
    expect(errorOf((await signUp('cancelled@test.example', cancelled.cookie)).location)).toBe('unable_to_create_user')

    const first = await confirmAge()
    const second = await confirmAge(undefined, first.cookie)
    expect(errorOf((await signUp('old-token@test.example', first.cookie)).location)).toBe('unable_to_create_user')
    expect((await signUp('new-token@test.example', second.cookie)).location).toMatch(/\/chat$/)
    for (const email of ['late@test.example', 'cancelled@test.example', 'old-token@test.example']) expect(await users(email), email).toHaveLength(0)
  })

  it('lets an existing Google student sign in with no confirmation and does not re-register them', async () => {
    const before = await users('adult@test.example')
    const auth = createAuth()
    const back = await callback(auth, await start(auth, false), { email: 'adult@test.example', sub: 'sub-adult@test.example' })
    expect(back.location).toMatch(/\/chat$/)
    expect(await users('adult@test.example')).toEqual(before)
    expect(await resolveStudentContext(new Headers({ cookie: back.cookies }))).toMatchObject({ state: 'ok' })
  })

  it('leaves staff untouched: the CLI creates staff without a confirmation, and staff stay out of the student area', async () => {
    const cli = (args: string[]) => runAdminCli(args, { env: process.env, readPassword: async () => 'correct horse battery staple', log: () => {}, actor: 'cli:test' })
    await cli(['create', '--email', 'age-staff@test.example', '--role', 'reviewer', '--name', 'Synthetic Reviewer'])
    const signIn = (await createAuth().api.signInEmail({ body: { email: 'age-staff@test.example', password: 'correct horse battery staple' }, asResponse: true })) as Response
    const cookie = cookiesFrom(signIn)
    expect(await resolveAdminContext(new Headers({ cookie }))).toMatchObject({ state: 'ok', actor: { role: 'reviewer' } })
    expect(await resolveStudentContext(new Headers({ cookie }))).toMatchObject({ state: 'forbidden' })
  })
})
