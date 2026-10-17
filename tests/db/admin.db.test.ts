// Stage 3 admin workflow, authentication and authorisation against a real database.
// Synthetic data only. Run with `pnpm test:db` (or DB_TEST_URL=… for the target engine).
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { runAdminCli } from '../../scripts/admin-user.mjs'
import { todayIso } from '@/lib/data/publication'

// ---- Next.js runtime stand-ins for calling server actions / route handlers directly ----
const requestState = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => requestState.headers }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

const { ADMIN_ROLES } = await import('@/lib/admin/roles')
type AdminActor = import('@/lib/admin/roles').AdminActor
const W = await import('@/lib/admin/workflow')
const Q = await import('@/lib/admin/queries')
const { verifyAuditChain } = await import('@/lib/admin/audit')
const { formId } = await import('@/lib/admin/forms')
const { isEntityKey } = await import('@/lib/admin/entities')
const { resolveAdminContext } = await import('@/lib/admin/access')
const { getAuth, createAuth } = await import('@/lib/auth')
const { fetchDestinationDirectory } = await import('@/lib/db/directory-queries')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
const actions = await import('@/app/admin/actions')
const reviewQueueRoute = await import('@/app/api/admin/review-queue/route')
const auditRoute = await import('@/app/api/admin/audit/route')

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const addDays = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const SECRET = 'test-secret-'.padEnd(48, 'x')
const PASSWORD = 'correct horse battery staple'

const form = (fields: Record<string, string | undefined>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v)
  return f
}
async function rows<R = RowDataPacket>(sql: string, params: unknown[] = []): Promise<R[]> {
  const [r] = await db.query<RowDataPacket[]>(sql, params)
  return r as R[]
}

const owner: AdminActor = { userId: 'u-owner', name: 'Owner', email: 'owner@test.example', role: 'owner' }
const reviewer: AdminActor = { userId: 'u-reviewer', name: 'Reviewer', email: 'reviewer@test.example', role: 'reviewer' }
const editor: AdminActor = { userId: 'u-editor', name: 'Editor', email: 'editor@test.example', role: 'editor' }

let seq = 0
async function newSource(type = 'university_official') {
  seq += 1
  return W.createSource(getAdminPool(), editor, form({
    url: `https://uni.example/page/${seq}`,
    title: `Synthetic page ${seq}`,
    publisher: 'Example University (synthetic)',
    sourceType: type,
    retrievedAt: TODAY,
  }))
}
const verifyForm = (sourceId: number, status = 'verified', extra: Record<string, string> = {}) =>
  form({ verificationStatus: status, sourceId: String(sourceId), checkedAt: TODAY, reviewDueAt: addDays(180), ...extra })

async function publishedUniversity(destination = 'DE') {
  const src = await newSource()
  seq += 1
  const id = await W.createRecord(getAdminPool(), editor, 'university', form({
    name: `Synthetic University ${seq}`, slug: `synthetic-${seq}`, destinationIso2: destination, officialWebsite: 'https://uni.example/', sourceId: String(src),
  }), null)
  await W.transitionRecord(getAdminPool(), editor, 'university', id, 'submit_for_review', form({}))
  await W.transitionRecord(getAdminPool(), reviewer, 'university', id, 'verify', verifyForm(src))
  await W.transitionRecord(getAdminPool(), reviewer, 'university', id, 'publish', form({}))
  return { id, src }
}

async function publishedCourse(universityId: number, src: number) {
  seq += 1
  const id = await W.createRecord(getAdminPool(), editor, 'course', form({
    name: `MSc Synthetic ${seq}`, slug: `msc-${seq}`, studyLevel: 'PG', qualification: 'master',
  }), universityId)
  await W.transitionRecord(getAdminPool(), editor, 'course', id, 'submit_for_review', form({}))
  await W.transitionRecord(getAdminPool(), reviewer, 'course', id, 'verify', verifyForm(src))
  await W.transitionRecord(getAdminPool(), reviewer, 'course', id, 'publish', form({}))
  return id
}

beforeAll(async () => {
  server = await startTestDatabase()
  console.info(`[db] admin suite running on ${server.engine}`)
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  Object.assign(process.env, { DATABASE_URL: server.url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: 'http://localhost:3000' })
}, 240_000)

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

describe('schema 0002', () => {
  it('keeps admin roles and audit actions in sync with TypeScript', async () => {
    const enumOf = async (table: string, column: string) => {
      const [r] = await rows<{ COLUMN_TYPE: string }>(
        'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column],
      )
      return [...r.COLUMN_TYPE.matchAll(/'([^']+)'/g)].map((m) => m[1])
    }
    expect(await enumOf('admin_members', 'role')).toEqual([...ADMIN_ROLES])
    expect(await enumOf('data_change_log', 'action')).toEqual(expect.arrayContaining(['return_to_draft', 'reverify', 'terms_change', 'role_grant', 'role_revoke']))
  })

  it('seeds ECB, Frankfurter, FBIL and IMF as unapproved FX candidates, so no INR rate is public', async () => {
    const providers = await rows<{ slug: string; terms_status: string }>('SELECT slug, terms_status FROM fx_providers ORDER BY slug')
    expect(providers.map((p) => p.slug)).toEqual(['ecb', 'fbil', 'frankfurter', 'imf'])
    for (const p of providers) expect(p.terms_status).toBe('not_reviewed')
    expect(await rows('SELECT * FROM public_fx_rates')).toHaveLength(0)
  })

  it('lets a draft fee omit its amount but never a verified one', async () => {
    const { id: uni, src } = await publishedUniversity()
    const course = await publishedCourse(uni, src)
    await db.query("INSERT INTO tuition_fees SET course_id = ?, currency = 'EUR', billing_period = 'per_year', amount = NULL", [course])
    await expect(
      db.query(
        "INSERT INTO tuition_fees SET course_id = ?, currency = 'EUR', billing_period = 'per_year', amount = NULL, academic_year = '2026', verification_status = 'verified', source_id = ?, checked_at = ?, verified_at = NOW(), verified_by = 'x', review_due_at = ?",
        [course, src, TODAY, addDays(30)],
      ),
    ).rejects.toThrow(/check constraint|constraint/i)
  })
})

describe('university workflow: capture → review → verify → publish → re-verify → unpublish', () => {
  it('runs the full lifecycle and records every step in the hash-chained log', async () => {
    const pool = getAdminPool()
    const src = await newSource()
    const id = await W.createRecord(pool, editor, 'university', form({
      name: 'Lifecycle University', slug: 'lifecycle-university', destinationIso2: 'FI', officialWebsite: 'https://life.example/', sourceId: String(src),
    }), null)

    const live = async () => (await rows('SELECT id FROM public_universities WHERE id = ?', [id])).length === 1
    expect(await live()).toBe(false)

    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'publish', form({}))).rejects.toMatchObject({
      blockers: expect.arrayContaining(['Submit the record for review first.']),
    })
    await W.transitionRecord(pool, editor, 'university', id, 'submit_for_review', form({}))
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'publish', form({}))).rejects.toMatchObject({
      blockers: expect.arrayContaining(['Verify the record before publishing.']),
    })
    await W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src))
    await W.transitionRecord(pool, reviewer, 'university', id, 'publish', form({}))
    expect(await live()).toBe(true)

    await W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src, 'verified', { reviewDueAt: addDays(365) }))
    const [afterReverify] = await rows<{ review_due_at: string; verified_by: string }>('SELECT review_due_at, verified_by FROM universities WHERE id = ?', [id])
    expect(afterReverify).toMatchObject({ review_due_at: addDays(365), verified_by: reviewer.userId })

    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'unpublish', form({ reason: '' }))).rejects.toMatchObject({ fieldErrors: { reason: expect.any(Array) } })
    await W.transitionRecord(pool, reviewer, 'university', id, 'unpublish', form({ reason: 'Fees page moved; re-checking.' }))
    expect(await live()).toBe(false)

    const log = await rows<{ action: string; actor_id: string }>("SELECT action, actor_id FROM data_change_log WHERE entity_type = 'university' AND entity_id = ? ORDER BY id", [id])
    expect(log.map((l) => l.action)).toEqual(['create', 'submit_for_review', 'verify', 'publish', 'reverify', 'unpublish'])
    expect(log.map((l) => l.actor_id)).toEqual([editor.userId, editor.userId, reviewer.userId, reviewer.userId, reviewer.userId, reviewer.userId])
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true })
  })

  it('validates verification input and the source', async () => {
    const pool = getAdminPool()
    const src = await newSource()
    const id = await W.createRecord(pool, editor, 'university', form({ name: 'Validation U', slug: 'validation-u', destinationIso2: 'PL' }), null)
    await W.transitionRecord(pool, editor, 'university', id, 'submit_for_review', form({}))
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src, 'verified', { checkedAt: addDays(2) }))).rejects.toMatchObject({ fieldErrors: { checkedAt: expect.any(Array) } })
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src, 'verified', { reviewDueAt: TODAY }))).rejects.toMatchObject({ fieldErrors: { reviewDueAt: expect.any(Array) } })
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'verify', form({ verificationStatus: 'verified', checkedAt: TODAY, reviewDueAt: addDays(9) }))).rejects.toMatchObject({ fieldErrors: { sourceId: expect.any(Array) } })
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(999_999))).rejects.toThrow(/source does not exist/)
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src, 'unavailable'))).rejects.toThrow(/cannot be marked/)
    // Verified, but no official website → still blocked.
    await W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src))
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'publish', form({}))).rejects.toMatchObject({ blockers: ['Add the official website.'] })
  })

  it('blocks publishing once the verification has expired', async () => {
    const pool = getAdminPool()
    const src = await newSource()
    const id = await W.createRecord(pool, editor, 'university', form({ name: 'Expired U', slug: 'expired-u', destinationIso2: 'IT', officialWebsite: 'https://x.example/' }), null)
    await W.transitionRecord(pool, editor, 'university', id, 'submit_for_review', form({}))
    await W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src))
    await db.query('UPDATE universities SET checked_at = ?, review_due_at = ? WHERE id = ?', [addDays(-30), addDays(-1), id])
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'publish', form({}))).rejects.toMatchObject({
      blockers: expect.arrayContaining(['The review date has passed. Re-verify first.']),
    })
    const queue = await Q.getReviewQueue(db)
    expect(queue.find((q) => q.entity === 'university' && q.id === id)?.reason).toBe('in_review')
  })

  it('locks published records against edits, and resets verification when a draft is edited', async () => {
    const pool = getAdminPool()
    const { id } = await publishedUniversity('AU')
    await expect(W.updateRecord(pool, editor, 'university', id, form({ name: 'Changed', slug: 'changed', destinationIso2: 'AU' }))).rejects.toThrow(/Unpublish/)

    const src = await newSource()
    const draft = await W.createRecord(pool, editor, 'university', form({ name: 'Draft U', slug: 'draft-u', destinationIso2: 'AU', officialWebsite: 'https://d.example/' }), null)
    await W.transitionRecord(pool, editor, 'university', draft, 'submit_for_review', form({}))
    await W.transitionRecord(pool, reviewer, 'university', draft, 'verify', verifyForm(src))
    await W.updateRecord(pool, editor, 'university', draft, form({ name: 'Draft U (renamed)', slug: 'draft-u', destinationIso2: 'AU', officialWebsite: 'https://d.example/' }))
    const [r] = await rows<{ publication_status: string; verification_status: string; verified_by: string | null }>(
      'SELECT publication_status, verification_status, verified_by FROM universities WHERE id = ?', [draft])
    expect(r).toEqual({ publication_status: 'draft', verification_status: 'unverified', verified_by: null })
  })

  it('returns a record to draft with a reason, and the public directory only ever shows it while published', async () => {
    const pool = getAdminPool()
    const publicNames = async () => (await fetchDestinationDirectory(getPool(), 'CA', TODAY)).map((u) => u.name)
    const src = await newSource()
    const id = await W.createRecord(pool, editor, 'university', form({
      name: 'Staging Synthetic University', slug: 'staging-synthetic', destinationIso2: 'CA', officialWebsite: 'https://staging-synthetic.example/', sourceId: String(src),
    }), null)
    expect(await publicNames()).not.toContain('Staging Synthetic University')

    await W.transitionRecord(pool, editor, 'university', id, 'submit_for_review', form({}))
    await expect(W.transitionRecord(pool, editor, 'university', id, 'return_to_draft', form({ reason: 'Wrong city' }))).rejects.toThrow()
    await expect(W.transitionRecord(pool, reviewer, 'university', id, 'return_to_draft', form({ reason: '' }))).rejects.toMatchObject({ fieldErrors: { reason: expect.any(Array) } })
    await W.transitionRecord(pool, reviewer, 'university', id, 'return_to_draft', form({ reason: 'Official website needs re-checking.' }))
    const [draft] = await rows<{ publication_status: string }>('SELECT publication_status FROM universities WHERE id = ?', [id])
    expect(draft.publication_status).toBe('draft')
    expect(await publicNames()).not.toContain('Staging Synthetic University')

    await W.transitionRecord(pool, editor, 'university', id, 'submit_for_review', form({}))
    await W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src))
    expect(await publicNames()).not.toContain('Staging Synthetic University') // verified, not yet published
    await W.transitionRecord(pool, reviewer, 'university', id, 'publish', form({}))
    expect(await publicNames()).toContain('Staging Synthetic University')

    await W.transitionRecord(pool, reviewer, 'university', id, 'unpublish', form({ reason: 'Staging check' }))
    expect(await publicNames()).not.toContain('Staging Synthetic University')

    const log = await rows<{ action: string; reason: string | null }>("SELECT action, reason FROM data_change_log WHERE entity_type = 'university' AND entity_id = ? ORDER BY id", [id])
    expect(log.map((l) => l.action)).toEqual(['create', 'submit_for_review', 'return_to_draft', 'submit_for_review', 'verify', 'publish', 'unpublish'])
    expect(log[2].reason).toBe('Official website needs re-checking.')
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true })
  })

  it('lets exactly one of two concurrent reviewers publish the same record', async () => {
    const pool = getAdminPool()
    const src = await newSource()
    const id = await W.createRecord(pool, editor, 'university', form({ name: 'Race U', slug: 'race-u', destinationIso2: 'NZ', officialWebsite: 'https://r.example/' }), null)
    await W.transitionRecord(pool, editor, 'university', id, 'submit_for_review', form({}))
    await W.transitionRecord(pool, reviewer, 'university', id, 'verify', verifyForm(src))
    const results = await Promise.allSettled([
      W.transitionRecord(pool, reviewer, 'university', id, 'publish', form({})),
      W.transitionRecord(pool, owner, 'university', id, 'publish', form({})),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await rows("SELECT id FROM data_change_log WHERE entity_type = 'university' AND entity_id = ? AND action = 'publish'", [id])).toHaveLength(1)
  })
})

describe('fees, acceptance rates and rankings', () => {
  it('captures a "not published" fee, verifies it as unavailable and publishes it', async () => {
    const pool = getAdminPool()
    const { id: uni, src } = await publishedUniversity('AE')
    const course = await publishedCourse(uni, src)
    const fee = await W.createRecord(pool, editor, 'tuition_fee', form({ category: 'international', currency: 'AED', billingPeriod: 'per_year' }), course)
    await W.transitionRecord(pool, editor, 'tuition_fee', fee, 'submit_for_review', form({}))
    await expect(W.transitionRecord(pool, reviewer, 'tuition_fee', fee, 'verify', verifyForm(src))).rejects.toThrow(/needs its published value/)
    await W.transitionRecord(pool, reviewer, 'tuition_fee', fee, 'verify', verifyForm(src, 'unavailable'))
    await W.transitionRecord(pool, reviewer, 'tuition_fee', fee, 'publish', form({}))
    const [pub] = await rows<{ amount: string | null; verification_status: string }>('SELECT amount, verification_status FROM public_tuition_fees WHERE id = ?', [fee])
    expect(pub).toEqual({ amount: null, verification_status: 'unavailable' })
  })

  it('requires a dated amount before a fee can be verified', async () => {
    const pool = getAdminPool()
    const { id: uni, src } = await publishedUniversity('GB')
    const course = await publishedCourse(uni, src)
    await expect(W.createRecord(pool, editor, 'tuition_fee', form({ category: 'international', currency: 'GBP', billingPeriod: 'per_year', amount: '12.345' }), course)).rejects.toMatchObject({ fieldErrors: { amount: expect.any(Array) } })
    const fee = await W.createRecord(pool, editor, 'tuition_fee', form({ category: 'international', currency: 'GBP', billingPeriod: 'per_year', amount: '26000.00' }), course)
    await W.transitionRecord(pool, editor, 'tuition_fee', fee, 'submit_for_review', form({}))
    await expect(W.transitionRecord(pool, reviewer, 'tuition_fee', fee, 'verify', verifyForm(src))).rejects.toThrow(/academic year or a valid-to date/)
  })

  it('ties a programme-level acceptance rate to a course of the same university', async () => {
    const pool = getAdminPool()
    const a = await publishedUniversity('CA')
    const b = await publishedUniversity('CA')
    const otherCourse = await publishedCourse(b.id, b.src)
    await expect(W.createRecord(pool, editor, 'acceptance_rate', form({ ratePercent: '40', definition: 'Offers divided by completed applications', scope: 'programme', cohortLabel: '2025', courseId: String(otherCourse) }), a.id)).rejects.toThrow(/different university/)
  })

  it('keeps a verified QS ranking unpublishable until rights are licensed, and hidden after expiry', async () => {
    const pool = getAdminPool()
    const { id: uni } = await publishedUniversity('US')
    const [{ id: qs }] = await rows<{ id: number }>("SELECT id FROM ranking_providers WHERE slug = 'qs'")
    const rsrc = await newSource('ranking_provider')
    const ranking = await W.createRecord(pool, editor, 'university_ranking', form({ providerId: String(qs), year: '2026', position: '150' }), uni)
    await W.transitionRecord(pool, editor, 'university_ranking', ranking, 'submit_for_review', form({}))
    await W.transitionRecord(pool, reviewer, 'university_ranking', ranking, 'verify', verifyForm(rsrc))
    await expect(W.transitionRecord(pool, reviewer, 'university_ranking', ranking, 'publish', form({}))).rejects.toMatchObject({
      blockers: [expect.stringContaining('reuse rights are "not_confirmed"')],
    })

    // Reviewers can't change rights; owners can, and only with licence evidence.
    const licence = { id: String(qs), rightsStatus: 'licensed', licenceReference: 'SYNTHETIC-TEST', licenceScope: 'Test scope', rightsCheckedAt: TODAY }
    await expect(W.updateRankingRights(pool, reviewer, qs, form(licence))).rejects.toBeInstanceOf(W.PermissionError)
    await expect(W.updateRankingRights(pool, owner, qs, form({ ...licence, licenceReference: undefined }))).rejects.toMatchObject({ fieldErrors: { licenceReference: expect.any(Array) } })
    await W.updateRankingRights(pool, owner, qs, form(licence))
    await W.transitionRecord(pool, reviewer, 'university_ranking', ranking, 'publish', form({}))
    expect(await rows('SELECT id FROM public_university_rankings WHERE id = ?', [ranking])).toHaveLength(1)

    await db.query('UPDATE ranking_providers SET licence_expires_at = ? WHERE id = ?', [addDays(-1), qs])
    expect(await rows('SELECT id FROM public_university_rankings WHERE id = ?', [ranking])).toHaveLength(0)
    await W.updateRankingRights(pool, owner, qs, form({ rightsStatus: 'not_confirmed', rightsNotes: 'Reset after test' }))
  })
})

describe('exchange rates', () => {
  it('refuses rates until the provider terms are approved, then gates them through public_fx_rates', async () => {
    const pool = getAdminPool()
    const [{ id: ecb }] = await rows<{ id: number }>("SELECT id FROM fx_providers WHERE slug = 'ecb'")
    const fxSrc = await newSource('exchange_rate_provider')
    const uniSrc = await newSource()
    const rate = (sourceId: number) => form({ providerId: String(ecb), sourceId: String(sourceId), baseCurrency: 'EUR', rate: '106.5283', rateDate: TODAY })

    await expect(W.createFxRate(pool, reviewer, rate(fxSrc))).rejects.toThrow(/not been approved/)
    await expect(W.updateFxProviderTerms(pool, owner, ecb, form({ termsStatus: 'approved' }))).rejects.toMatchObject({ fieldErrors: { attributionText: expect.any(Array) } })
    await W.updateFxProviderTerms(pool, owner, ecb, form({
      termsStatus: 'approved',
      currenciesCovered: 'EUR',
      attributionText: 'Source: European Central Bank',
      updateFrequency: 'Daily',
      termsCheckedAt: TODAY,
      reason: 'Approved ECB terms after legal review',
    }))
    const [fxLog] = await rows<{ reason: string | null }>("SELECT reason FROM data_change_log WHERE entity_type = 'fx_provider' AND entity_id = ? ORDER BY id DESC LIMIT 1", [ecb])
    expect(fxLog.reason).toBe('Approved ECB terms after legal review')
    await expect(W.createFxRate(pool, editor, rate(fxSrc))).rejects.toBeInstanceOf(W.PermissionError)
    await expect(W.createFxRate(pool, reviewer, rate(uniSrc))).rejects.toThrow(/exchange rate provider/)
    await expect(W.createFxRate(pool, reviewer, form({ providerId: String(ecb), sourceId: String(fxSrc), baseCurrency: 'INR', rate: '1', rateDate: TODAY }))).rejects.toMatchObject({ fieldErrors: { baseCurrency: expect.any(Array) } })
    const rateId = await W.createFxRate(pool, reviewer, rate(fxSrc))
    expect(await rows('SELECT * FROM public_fx_rates')).toHaveLength(1)

    // Immutability triggers block UPDATE and DELETE on sources and fx_rates.
    await expect(db.query("UPDATE sources SET title = 'tampered' WHERE id = ?", [fxSrc])).rejects.toThrow(/sources is append-only/)
    await expect(db.query('DELETE FROM sources WHERE id = ?', [fxSrc])).rejects.toThrow(/sources is append-only/)
    await expect(db.query('UPDATE fx_rates SET rate = 999 WHERE id = ?', [rateId])).rejects.toThrow(/fx_rates is append-only/)
    await expect(db.query('DELETE FROM fx_rates WHERE id = ?', [rateId])).rejects.toThrow(/fx_rates is append-only/)

    await W.updateFxProviderTerms(pool, owner, ecb, form({ termsStatus: 'not_reviewed', reason: 'Reverting after test' }))
    expect(await rows('SELECT * FROM public_fx_rates')).toHaveLength(0)
  })
})

describe('injection resistance', () => {
  it('stores hostile text literally and never interpolates it into SQL', async () => {
    const pool = getAdminPool()
    const payload = "Robert'); DROP TABLE universities; -- "
    const id = await W.createRecord(pool, editor, 'university', form({ name: payload, slug: 'bobby-tables', destinationIso2: 'SA' }), null)
    const [r] = await rows<{ name: string }>('SELECT name FROM universities WHERE id = ?', [id])
    expect(r.name).toBe(payload.trim())
    expect(await rows("SHOW TABLES LIKE 'universities'")).toHaveLength(1)

    expect(await Q.listUniversities(db, { q: "%' OR '1'='1" })).toHaveLength(0)
    expect((await Q.listUniversities(db, { q: '%' })).length).toBe(0) // % is escaped, not a wildcard
    await expect(W.createRecord(pool, editor, 'university', form({ name: 'X', slug: "x'; DROP TABLE sources; --", destinationIso2: 'SA' }), null)).rejects.toMatchObject({ fieldErrors: { slug: expect.any(Array) } })
    expect(formId(form({ id: '1 OR 1=1' }), 'id')).toBeNull()
    expect(isEntityKey('universities; DROP TABLE sources')).toBe(false)
    expect(isEntityKey('__proto__')).toBe(false)
  })
})

describe('authentication and authorisation', () => {
  let ownerCookie = ''
  let editorCookie = ''
  let outsiderCookie = ''
  let revokedUserId = ''

  const cli = (args: string[], password = PASSWORD) =>
    runAdminCli(args, { env: process.env, readPassword: async () => password, log: () => {}, actor: 'cli:test' }) as Promise<{ userId: string }>

  async function signIn(email: string, password = PASSWORD): Promise<string> {
    const res = (await getAuth()!.api.signInEmail({ body: { email, password }, asResponse: true })) as Response
    if (!res.ok) throw new Error(`sign-in failed: ${res.status}`)
    return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  }
  const asCookie = (cookie: string) => {
    requestState.headers = new Headers(cookie ? { cookie } : {})
  }
  const apiRequest = (path: string, cookie = '') => new Request(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} })

  beforeAll(async () => {
    await cli(['create', '--email', 'owner@test.example', '--name', 'Synthetic Owner', '--role', 'owner'])
    await cli(['create', '--email', 'editor@test.example', '--name', 'Synthetic Editor', '--role', 'editor'])
    const outsider = await cli(['create', '--email', 'outsider@test.example', '--name', 'No Access', '--role', 'editor'])
    await db.query('DELETE FROM admin_members WHERE user_id = ?', [outsider.userId]) // e.g. a future OAuth user
    const revoked = await cli(['create', '--email', 'former@test.example', '--name', 'Former Admin', '--role', 'reviewer'])
    revokedUserId = revoked.userId
    ownerCookie = await signIn('owner@test.example')
    editorCookie = await signIn('editor@test.example')
    outsiderCookie = await signIn('outsider@test.example')
  })

  it('provisions only through the CLI: no password arguments, policy enforced, no duplicates', async () => {
    await expect(cli(['create', '--email', 'short@test.example', '--name', 'S', '--role', 'editor'], 'short')).rejects.toThrow(/12–128 characters/)
    await expect(cli(['create', '--email', 'owner@test.example', '--name', 'Dup', '--role', 'owner'])).rejects.toThrow(/already has an account/)
    await expect(cli(['create', '--email', 'x@test.example', '--name', 'X', '--role', 'owner', '--password', 'hunter2hunter2'])).rejects.toThrow(/Unknown option/)
    await expect(cli(['grant', '--email', 'owner@test.example', '--role', 'superuser'])).rejects.toThrow(/--role must be/)
    await expect(getAuth()!.api.signUpEmail({ body: { email: 'self@test.example', password: PASSWORD, name: 'Self' } })).rejects.toThrow()
    expect(await rows("SELECT id FROM auth_user WHERE email = 'self@test.example'")).toHaveLength(0)
    const [acct] = await rows<{ password: string }>("SELECT a.password FROM auth_account a JOIN auth_user u ON u.id = a.userId WHERE u.email = 'owner@test.example'")
    expect(acct.password).not.toContain(PASSWORD)
  })

  it('rejects a wrong password with a generic error', async () => {
    await expect(signIn('owner@test.example', 'wrong password!!')).rejects.toThrow(/401/)
    await expect(signIn('nobody@test.example', 'wrong password!!')).rejects.toThrow(/401/)
  })

  it('distinguishes signed-out, non-administrator and administrator sessions', async () => {
    expect(await resolveAdminContext(new Headers())).toEqual({ state: 'signed_out' })
    expect(await resolveAdminContext(new Headers({ cookie: 'better-auth.session_token=forged.value' }))).toEqual({ state: 'signed_out' })
    expect(await resolveAdminContext(new Headers({ cookie: outsiderCookie }))).toMatchObject({ state: 'forbidden' })
    expect(await resolveAdminContext(new Headers({ cookie: ownerCookie }))).toMatchObject({ state: 'ok', actor: { role: 'owner', email: 'owner@test.example' } })
  })

  it('fails closed when the auth secret is missing', async () => {
    const saved = process.env.BETTER_AUTH_SECRET
    process.env.BETTER_AUTH_SECRET = ''
    try {
      expect(getAuth()).toBeNull()
      expect(await resolveAdminContext(new Headers({ cookie: ownerCookie }))).toEqual({ state: 'not_configured' })
      expect((await reviewQueueRoute.GET(apiRequest('/api/admin/review-queue', ownerCookie))).status).toBe(503)
    } finally {
      process.env.BETTER_AUTH_SECRET = saved
    }
  })

  it('expires sessions server-side', async () => {
    const cookie = await signIn('editor@test.example')
    expect((await resolveAdminContext(new Headers({ cookie }))).state).toBe('ok')
    const token = decodeURIComponent(cookie.split('=')[1]).split('.')[0]
    await db.query('UPDATE auth_session SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE token = ?', [token])
    expect(await resolveAdminContext(new Headers({ cookie }))).toEqual({ state: 'signed_out' })
  })

  it('revoking a member blocks them immediately and ends their sessions', async () => {
    const cookie = await signIn('former@test.example')
    expect((await resolveAdminContext(new Headers({ cookie }))).state).toBe('ok')
    await cli(['revoke', '--email', 'former@test.example'])
    expect((await resolveAdminContext(new Headers({ cookie }))).state).toBe('signed_out')
    expect(await rows('SELECT id FROM auth_session WHERE userId = ?', [revokedUserId])).toHaveLength(0)
    const [m] = await rows<{ status: string }>('SELECT status FROM admin_members WHERE user_id = ?', [revokedUserId])
    expect(m.status).toBe('revoked')
  })

  it('issues HttpOnly, Secure, SameSite=Lax __Secure- session cookies for an https origin', async () => {
    const staging = createAuth('https://staging.lockin.example')
    const res = (await staging.api.signInEmail({ body: { email: 'owner@test.example', password: PASSWORD }, asResponse: true })) as Response
    expect(res.ok).toBe(true)
    const session = res.headers.getSetCookie().find((c) => c.includes('session_token='))!
    expect(session).toMatch(/^__Secure-better-auth\.session_token=/)
    expect(session).toMatch(/;\s*Secure/i)
    expect(session).toMatch(/;\s*HttpOnly/i)
    expect(session).toMatch(/;\s*SameSite=Lax/i)
    expect(session).toMatch(/;\s*Path=\//i)
    expect(session).not.toMatch(/Domain=/i)
  })

  it('fails closed when a required migration is not recorded (e.g. after a partial failure)', async () => {
    expect((await resolveAdminContext(new Headers({ cookie: ownerCookie }))).state).toBe('ok')
    const [[saved]] = await db.query<RowDataPacket[]>("SELECT name, checksum, applied_at FROM schema_migrations WHERE name = '0002_admin_auth.sql'")
    await db.query("DELETE FROM schema_migrations WHERE name = '0002_admin_auth.sql'")
    try {
      expect(await resolveAdminContext(new Headers({ cookie: ownerCookie }))).toEqual({ state: 'error' })
      expect((await reviewQueueRoute.GET(apiRequest('/api/admin/review-queue', ownerCookie))).status).toBe(503)
      const body = await (await auditRoute.GET(apiRequest('/api/admin/audit', ownerCookie))).text()
      expect(body).not.toMatch(/schema_migrations|SELECT|mysql|password/i)
    } finally {
      await db.query('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)', [saved.name, saved.checksum, saved.applied_at])
    }
    expect((await resolveAdminContext(new Headers({ cookie: ownerCookie }))).state).toBe('ok')
  })

  it('enforces access in route handlers (direct API calls)', async () => {
    expect((await reviewQueueRoute.GET(apiRequest('/api/admin/review-queue'))).status).toBe(401)
    expect((await reviewQueueRoute.GET(apiRequest('/api/admin/review-queue', outsiderCookie))).status).toBe(403)
    const ok = await reviewQueueRoute.GET(apiRequest('/api/admin/review-queue', editorCookie))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect((await auditRoute.GET(apiRequest('/api/admin/audit', editorCookie))).status).toBe(403)
    const audit = await auditRoute.GET(apiRequest('/api/admin/audit', ownerCookie))
    expect(await audit.json()).toMatchObject({ ok: true })
  })

  it('enforces access in server actions before touching data', async () => {
    const count = async () => Number((await rows<{ n: number }>('SELECT COUNT(*) AS n FROM universities'))[0].n)
    const before = await count()
    const fields = { entity: 'university', name: 'Action U', slug: 'action-u', destinationIso2: 'DE' }

    asCookie('')
    expect(await actions.createRecordAction(null, form(fields))).toEqual({ ok: false, message: 'Sign in to continue.' })
    asCookie(outsiderCookie)
    expect(await actions.createRecordAction(null, form(fields))).toEqual({ ok: false, message: 'You do not have admin access.' })
    expect(await count()).toBe(before)

    asCookie(editorCookie)
    await expect(actions.createRecordAction(null, form(fields))).rejects.toThrow(/NEXT_REDIRECT:\/admin\/records\/university\/\d+/)
    expect(await count()).toBe(before + 1)
    const [{ id }] = await rows<{ id: number }>("SELECT id FROM universities WHERE slug = 'action-u'")

    await expect(actions.transitionAction(null, form({ entity: 'university', id: String(id), action: 'submit_for_review' }))).resolves.toMatchObject({ ok: true })
    // An editor forging a reviewer-only action is refused by the server.
    expect(await actions.transitionAction(null, form({ entity: 'university', id: String(id), action: 'publish' }))).toEqual({ ok: false, message: 'You do not have permission to do this.' })
    expect(await actions.transitionAction(null, form({ entity: 'universities', id: String(id), action: 'submit_for_review' }))).toMatchObject({ ok: false })
    expect(await actions.updateRankingRightsAction(null, form({ id: '1', rightsStatus: 'not_required', rightsCheckedAt: TODAY, rightsNotes: 'forged' }))).toMatchObject({ ok: false, message: 'You do not have permission to do this.' })
    const [qs] = await rows<{ rights_status: string }>("SELECT rights_status FROM ranking_providers WHERE slug = 'qs'")
    expect(qs.rights_status).toBe('not_confirmed')

    // Open-redirect attempt through returnTo is ignored.
    await expect(actions.createSourceAction(null, form({ url: 'https://redirect.example/', title: 'T', publisher: 'P', sourceType: 'other', retrievedAt: TODAY, returnTo: 'https://evil.example/' }))).rejects.toThrow(/NEXT_REDIRECT:\/admin\/sources\/\d+/)
  })
})

// Runs last: it tests immutability triggers first, then drops them to verify that the hash chain
// also detects out-of-band tampering if a DBA ever bypasses triggers.
describe('audit log integrity', () => {
  it('blocks UPDATE and DELETE on data_change_log via database triggers', async () => {
    const [target] = await rows<{ id: number }>('SELECT id FROM data_change_log ORDER BY id LIMIT 1')
    await expect(db.query("UPDATE data_change_log SET reason = 'tampered' WHERE id = ?", [target.id])).rejects.toThrow(/data_change_log is append-only/)
    await expect(db.query('DELETE FROM data_change_log WHERE id = ?', [target.id])).rejects.toThrow(/data_change_log is append-only/)
  })

  it('detects edited rows, deleted rows and a rewound chain head if triggers are bypassed', async () => {
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true })
    await db.query('DROP TRIGGER tr_change_log_no_update')
    await db.query('DROP TRIGGER tr_change_log_no_delete')
    const [target] = await rows<{ id: number; reason: string | null }>('SELECT id, reason FROM data_change_log WHERE row_hash IS NOT NULL ORDER BY id LIMIT 1 OFFSET 3')

    await db.query("UPDATE data_change_log SET reason = 'tampered' WHERE id = ?", [target.id])
    expect(await verifyAuditChain(db)).toMatchObject({ ok: false, brokenAtId: target.id })
    await db.query('UPDATE data_change_log SET reason = ? WHERE id = ?', [target.reason, target.id])
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true })

    const [last] = await rows<{ id: number }>('SELECT id FROM data_change_log ORDER BY id DESC LIMIT 1')
    await db.query('DELETE FROM data_change_log WHERE id = ?', [last.id])
    expect(await verifyAuditChain(db)).toMatchObject({ ok: false })

    await db.query('DELETE FROM data_change_log WHERE id = ?', [target.id])
    expect(await verifyAuditChain(db)).toMatchObject({ ok: false, reason: expect.stringMatching(/changed or deleted/) })
  })
})
