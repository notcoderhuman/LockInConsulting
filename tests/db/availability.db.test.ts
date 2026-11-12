// Dev availability, per-student visibility and active-chat presence (0016, lib/support/availability.ts) against a
// real database. Synthetic data only.
import type { Connection } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

const A = await import('@/lib/support/availability')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
type AdminActor = import('@/lib/admin/roles').AdminActor

let server: TestDatabase
let db: Connection
const pool = () => getAdminPool()

// Dev signs in twice (two logins = two sessions); a second team member; an editor without support access.
const login1: AdminActor = { userId: 'u-dev', name: 'Dev Gautam', email: 'dev@test.example', role: 'owner', sessionId: 'sess-dev-1' }
const login2: AdminActor = { ...login1, sessionId: 'sess-dev-2' }
const other: AdminActor = { userId: 'u-rhea', name: 'Rhea Reviewer', email: 'rhea@test.example', role: 'reviewer', sessionId: 'sess-rhea' }
const editor: AdminActor = { userId: 'u-ed', name: 'Ed Editor', email: 'ed@test.example', role: 'editor', sessionId: 'sess-ed' }
let studentA = 0
let studentB = 0
let convA = 0
let convB = 0

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  Object.assign(process.env, { DATABASE_URL: server.url, BETTER_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'), BETTER_AUTH_URL: 'http://localhost:3000' })
  for (const [id, name] of [['u-dev', 'Dev Gautam'], ['u-rhea', 'Rhea Reviewer'], ['u-ed', 'Ed Editor'], ['u-sa', 'Asha Student'], ['u-sb', 'Bilal Student']])
    await db.query('INSERT INTO auth_user (id, name, email, emailVerified, updatedAt) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3))', [id, name, `${id}@test.example`])
  await db.query("INSERT INTO admin_members (user_id, role, status, granted_by) VALUES ('u-dev', 'owner', 'active', 'cli:test'), ('u-rhea', 'reviewer', 'active', 'cli:test'), ('u-ed', 'editor', 'active', 'cli:test')")
  for (const a of [login1, login2, other, editor])
    await db.query('INSERT INTO auth_session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, UTC_TIMESTAMP(3) + INTERVAL 1 DAY, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?)', [a.sessionId, `tok-${a.sessionId}`, a.userId])
  const [ra] = await db.query("INSERT INTO student_profiles (user_id, display_name) VALUES ('u-sa', 'Asha Student')")
  const [rb] = await db.query("INSERT INTO student_profiles (user_id, display_name) VALUES ('u-sb', 'Bilal Student')")
  studentA = Number((ra as { insertId: number }).insertId)
  studentB = Number((rb as { insertId: number }).insertId)
  const [ca] = await db.query("INSERT INTO conversations (student_profile_id, subject) VALUES (?, 'Poland · MSc Computer Science')", [studentA])
  const [cb] = await db.query("INSERT INTO conversations (student_profile_id, subject) VALUES (?, 'Germany · MBA')", [studentB])
  convA = Number((ca as { insertId: number }).insertId)
  convB = Number((cb as { insertId: number }).insertId)
}, 240_000)

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

const seenBy = async (profileId: number) => (await A.presenceForStudent(pool(), profileId))?.name ?? 'offline'
const visibleTo = (s: Awaited<ReturnType<typeof A.getMyAvailability>>, id: number) => s.students.find((x) => x.studentProfileId === id)?.visible

describe('Dev availability, student visibility and active-chat presence', () => {
  it('starts every login Offline with every student Offline, keeps settings across refreshes, and resets on the next login', async () => {
    const first = await A.getMyAvailability(pool(), login1)
    expect(first.available).toBe(false)
    expect(first.students.map((s) => s.visible)).toEqual([false, false])

    await A.setAvailable(pool(), login1, true)
    await A.setStudentVisible(pool(), login1, studentA, true)
    // A refresh is just another read in the same login.
    const refreshed = await A.getMyAvailability(pool(), login1)
    expect(refreshed.available).toBe(true)
    expect(visibleTo(refreshed, studentA)).toBe(true)
    expect(visibleTo(refreshed, studentB)).toBe(false)

    // A new login reads Offline everywhere, even before it changes anything…
    const next = await A.getMyAvailability(pool(), login2)
    expect(next.available).toBe(false)
    expect(next.students.every((s) => !s.visible)).toBe(true)
    // …and its first change wipes the old login's settings rather than inheriting them.
    await A.setAvailable(pool(), login2, true)
    expect(visibleTo(await A.getMyAvailability(pool(), login2), studentA)).toBe(false)
    expect((await db.query('SELECT COUNT(*) AS n FROM staff_student_visibility WHERE user_id = ?', ['u-dev']))[0]).toEqual([{ n: 0 }])
    await A.setAvailable(pool(), login2, false)
  })

  it('routes to Derek unless Dev is Online, has enabled the student AND is in their chat; nobody else ever sees Dev', async () => {
    const dev = login2
    // Offline: nobody sees Dev, Derek handles everything, even with the chat open.
    expect(await A.claimConversation(pool(), dev, convA)).toEqual({ state: 'mine', handling: false, available: false, visible: false })
    expect(await A.conversationHandler(pool(), convA)).toBeNull()
    expect(await seenBy(studentA)).toBe('offline')
    // Online alone: still nobody.
    await A.setAvailable(pool(), dev, true)
    expect(await A.claimConversation(pool(), dev, convA)).toMatchObject({ handling: false, available: true, visible: false })
    expect(await seenBy(studentA)).toBe('offline')
    // Student A enabled but Dev not in A's chat: still offline to A.
    await A.releaseConversation(pool(), dev, convA)
    await A.setStudentVisible(pool(), dev, studentA, true)
    expect(await seenBy(studentA)).toBe('offline')
    expect(await A.conversationHandler(pool(), convA)).toBeNull()
    // Dev enters A's chat: A (only A) sees Dev, and Derek holds back for that conversation only.
    expect(await A.claimConversation(pool(), dev, convA)).toEqual({ state: 'mine', handling: true, available: true, visible: true })
    expect(await seenBy(studentA)).toBe('Dev')
    expect(await A.presenceForStudent(pool(), studentA)).toMatchObject({ conversationId: convA })
    expect(await seenBy(studentB)).toBe('offline')
    expect(await A.conversationHandler(pool(), convB)).toBeNull()
    // Opening B's chat without enabling B shows nothing to B.
    expect(await A.claimConversation(pool(), dev, convB)).toMatchObject({ state: 'mine', handling: false, visible: false })
    expect(await seenBy(studentB)).toBe('offline')
    expect((await A.getMyAvailability(pool(), dev)).students.find((s) => s.studentProfileId === studentA)?.live).toBe(true)
    // The same visit keeps one joinedAt across heartbeats (one "has joined" notification).
    const joined = (await A.presenceForStudent(pool(), studentA))?.joinedAt
    await A.claimConversation(pool(), dev, convA)
    expect((await A.presenceForStudent(pool(), studentA))?.joinedAt).toBe(joined)

    // Leaving the chat: A sees Dev offline at once, and Derek resumes.
    await A.releaseConversation(pool(), dev, convA)
    expect(await seenBy(studentA)).toBe('offline')
    expect(await A.conversationHandler(pool(), convA)).toBeNull()
    // Back in, then Offline: offline to everyone immediately.
    await A.claimConversation(pool(), dev, convA)
    expect(await seenBy(studentA)).toBe('Dev')
    await A.setAvailable(pool(), dev, false)
    expect(await seenBy(studentA)).toBe('offline')
    expect(await A.conversationHandler(pool(), convA)).toBeNull()
    await A.setAvailable(pool(), dev, true)
    expect(await seenBy(studentA)).toBe('Dev')
  })

  it('never leaves Dev online after a closed tab, a signed-out session or a revoked membership', async () => {
    expect(await seenBy(studentA)).toBe('Dev')
    // Closed tab / lost network: the chat heartbeat lapses.
    await db.query('UPDATE conversation_presence SET last_seen_at = UTC_TIMESTAMP(3) - INTERVAL ? SECOND WHERE conversation_id = ?', [A.CHAT_PRESENCE.leaseSeconds + 5, convA])
    expect(await seenBy(studentA)).toBe('offline')
    await A.claimConversation(pool(), login2, convA)
    expect(await seenBy(studentA)).toBe('Dev')
    // Signed out (Better Auth deletes the session row).
    await db.query("DELETE FROM auth_session WHERE id = 'sess-dev-2'")
    expect(await seenBy(studentA)).toBe('offline')
    expect(await A.conversationHandler(pool(), convA)).toBeNull()
    await db.query("INSERT INTO auth_session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('sess-dev-2', UTC_TIMESTAMP(3) + INTERVAL 1 DAY, 'tok-again', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 'u-dev')")
    expect(await seenBy(studentA)).toBe('Dev')
    // Membership revoked.
    await db.query("UPDATE admin_members SET status = 'revoked', revoked_at = UTC_TIMESTAMP(3) WHERE user_id = 'u-dev'")
    expect(await seenBy(studentA)).toBe('offline')
    await db.query("UPDATE admin_members SET status = 'active', revoked_at = NULL WHERE user_id = 'u-dev'")
  })

  it('lets only one team member hold a chat, and only support staff change anything', async () => {
    // Dev holds A's chat: Rhea is refused while Dev's claim is fresh, and takes over once it lapses.
    expect(await A.claimConversation(pool(), other, convA)).toEqual({ state: 'other', name: 'Dev' })
    await db.query('UPDATE conversation_presence SET last_seen_at = UTC_TIMESTAMP(3) - INTERVAL 600 SECOND WHERE conversation_id = ?', [convA])
    expect(await A.claimConversation(pool(), other, convA)).toMatchObject({ state: 'mine', handling: false })
    expect(await A.claimConversation(pool(), login2, convA)).toEqual({ state: 'other', name: 'Rhea' })
    // Releasing only ever drops one's own claim.
    await A.releaseConversation(pool(), login2, convA)
    expect((await db.query('SELECT user_id FROM conversation_presence WHERE conversation_id = ?', [convA]))[0]).toEqual([{ user_id: 'u-rhea' }])

    await expect(A.setAvailable(pool(), editor, true)).rejects.toThrow()
    await expect(A.setStudentVisible(pool(), editor, studentA, true)).rejects.toThrow()
    await expect(A.getMyAvailability(pool(), editor)).rejects.toThrow()
    await expect(A.claimConversation(pool(), editor, convA)).rejects.toThrow()
    // No session on the actor (should not happen): refused, never treated as some other login.
    await expect(A.setAvailable(pool(), { ...login1, sessionId: undefined }, true)).rejects.toThrow()
    await expect(A.setStudentVisible(pool(), login2, 999_999, true)).rejects.toMatchObject({ status: 404 })
  })
})
