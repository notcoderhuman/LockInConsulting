// scripts/import-research.mjs against a real database, with SYNTHETIC research-shaped records.
// Imported records wait for review (never verified or published by the import), re-runs change
// nothing, an existing university is never overwritten, unquoted facts stay out, and only what a
// reviewer then verifies and publishes reaches the public directory, 5 at a time.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { factProblem, importResearch, loadResearch, planRecord } from '../../scripts/import-research.mjs'
import { todayIso } from '@/lib/data/publication'

const W = await import('@/lib/admin/workflow')
const { verifyAuditChain } = await import('@/lib/admin/audit')
const { fetchDirectoryPage } = await import('@/lib/db/directory-queries')
const { getAdminPool, getPool } = await import('@/lib/db/pool')
type AdminActor = import('@/lib/admin/roles').AdminActor

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const reviewer: AdminActor = { userId: 'u-reviewer', name: 'Reviewer', email: 'reviewer@test.example', role: 'reviewer' }
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const rows = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0]

const quoted = (field: string, value: unknown, sourceUrl: string) => ({
  field, scope: 'course_specific', value, evidence: `Official page: 'Synthetic quoted excerpt for ${field} on the course page.'`,
  checkedAt: '2026-10-18', validity: '2026-2027', result: 'captured', sourceUrl, publisher: 'Synthetic Faculty',
})
const record = (n: number, extra: { facts?: unknown[] } = {}) => ({
  destinationIso2: 'FI',
  officialName: `Synthetic Research University ${String(n).padStart(2, '0')}`,
  slug: `synthetic-research-${n}`,
  institutionType: 'public',
  city: 'Synthville',
  subRegion: null,
  identity: { url: `https://u${n}.example.edu/`, method: 'official_website', httpStatus: 200, pageTitle: `Synthetic ${n}`, checkedAt: '2026-10-18', result: 'captured' },
  facts: extra.facts ?? [],
})
const course = (n: number) => `https://u${n}.example.edu/study/msc-cs`
const fullRecord = (n: number) =>
  record(n, {
    facts: [
      quoted('programme', { name: 'MSc Computer Science', slug: 'msc-computer-science', qualification: 'master', studyLevel: 'PG', durationMonths: 24, studyMode: 'full_time', campus: 'Main', teachingLanguage: 'English', url: course(n) }, course(n)),
      quoted('tuition_fee', { currency: 'EUR', amount: '9000.00', billingPeriod: 'per_year', feeCategory: 'international', academicYear: '2026-2027', notes: null }, `${course(n)}/fees`),
      quoted('intake_deadline', { intakeMonth: 9, intakeYear: 2027, applicationDeadline: '2027-01-15' }, `${course(n)}/apply`),
      quoted('entry_requirements', 'A relevant bachelor degree.', course(n)),
      // Unsupported: template wording, no quote, home-page source (like the 77 templated records).
      { ...quoted('language_requirements', 'IELTS 6.5', `https://u${n}.example.edu/`), evidence: 'University English requirements for graduate applicants.' },
    ],
  })

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  process.env.DATABASE_URL = server.url
}, 240_000)

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

describe('research evidence rule', () => {
  it('imports a fact only when it quotes a specific official page', () => {
    const ok = quoted('programme', {}, 'https://u1.example.edu/study/msc')
    expect(factProblem(ok)).toBeNull()
    expect(factProblem({ ...ok, evidence: 'University published standard fee schedule for 2025-2026.' })).toBe('no quoted evidence')
    expect(factProblem({ ...ok, sourceUrl: 'https://u1.example.edu/' })).toBe('source is not a specific page')
    expect(factProblem({ ...ok, sourceUrl: 'http://u1.example.edu/study' })).toBe('source is not a specific page')
    expect(factProblem({ ...ok, result: 'blocked_automated_check' })).toMatch(/research result/)
    expect(factProblem(undefined)).toBe('not researched')
  })

  it('maps a record without inventing anything, and lists what it leaves out', () => {
    const plan = planRecord(fullRecord(1))
    expect(plan.university?.row).toMatchObject({ destination_iso2: 'FI', slug: 'synthetic-research-1', official_website: 'https://u1.example.edu/' })
    expect(plan.course?.row).toMatchObject({ slug: 'msc-computer-science', entry_requirements: 'A relevant bachelor degree.', language_requirements: null })
    expect(plan.fee?.row).toMatchObject({ amount: '9000.00', currency: 'EUR', billing_period: 'per_year' })
    expect(plan.skipped).toEqual(['language_requirements: source is not a specific page'])
    // A billing period outside the schema (e.g. "per_programme") is reported, never guessed.
    const odd = fullRecord(2)
    ;(odd.facts[1] as { value: { billingPeriod: string } }).value.billingPeriod = 'per_programme'
    expect(planRecord(odd).fee).toBeNull()
    expect(planRecord(odd).skipped).toContain('tuition_fee: invalid billing period')
    expect(JSON.stringify(planRecord(fullRecord(3)))).not.toMatch(/rank/i)
  })

  it('keeps the first copy of a duplicated record and reports differing copies', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'research-'))
    mkdirSync(path.join(dir, 'destinations'))
    const file = (records: unknown[]) => JSON.stringify({ status: 'pending_admin_entry', records })
    writeFileSync(path.join(dir, 'destinations', 'finland.json'), file([fullRecord(1), record(2)]))
    writeFileSync(path.join(dir, 'batch.json'), file([fullRecord(1), { ...record(2), facts: [quoted('programme', {}, course(2))] }]))
    const loaded = loadResearch(dir)
    expect(loaded.records.map((r: { slug: string }) => r.slug)).toEqual(['synthetic-research-1', 'synthetic-research-2'])
    expect(loaded.duplicates).toHaveLength(2)
    expect(loaded.conflicts.map((c: { key: string }) => c.key)).toEqual(['FI:synthetic-research-2'])
  })
})

describe('research import into the database', () => {
  it('creates records for review only: unverified, unpublished, audited, and public by name only', async () => {
    // An existing record with the same identity must survive untouched.
    const [src] = await db.query("INSERT INTO sources (url, title, publisher, source_type) VALUES ('https://existing.example/', 'Existing', 'Existing', 'university_official')")
    await db.query("INSERT INTO universities (destination_iso2, slug, name, official_website, source_id) VALUES ('FI', 'synthetic-research-7', 'Existing Name Kept', 'https://existing.example/', ?)", [(src as { insertId: number }).insertId])

    const records = Array.from({ length: 7 }, (_, i) => (i === 0 ? fullRecord(1) : record(i + 1)))
    const summary = await importResearch(getAdminPool(), records)
    expect(summary).toMatchObject({ universitiesCreated: 6, universitiesExisting: 1, coursesCreated: 1, campusesCreated: 1, intakesCreated: 1, feesCreated: 1, failed: [] })

    for (const table of ['universities', 'campuses', 'courses', 'course_intakes', 'tuition_fees']) {
      const statuses = await rows(`SELECT publication_status p, verification_status v FROM ${table} WHERE publication_status <> 'draft'`)
      expect(statuses.every((r) => r.p === 'in_review' && r.v === 'unverified'), table).toBe(true)
    }
    expect((await rows("SELECT name FROM universities WHERE slug = 'synthetic-research-7'"))[0].name).toBe('Existing Name Kept')
    expect((await rows("SELECT language_requirements FROM courses"))[0].language_requirements).toBeNull()
    expect((await rows("SELECT verification_notes FROM tuition_fees"))[0].verification_notes).toMatch(/^Imported research lead, NOT verified/)
    expect(await rows('SELECT id FROM university_rankings')).toHaveLength(0)
    // D-044: without a website check, the public sees names only: no website, city, date or detail.
    const listed = await fetchDirectoryPage(getPool(), 'FI', TODAY, 0)
    expect({ total: listed.total, verifiedTotal: listed.verifiedTotal }).toEqual({ total: 6, verifiedTotal: 0 })
    for (const e of listed.entries) expect(e).toMatchObject({ listing: 'provisional', identityStatus: 'pending', officialWebsite: null, city: null, identityCheckedAt: null })
    expect(listed.entries.some((e) => e.slug === 'synthetic-research-7')).toBe(false) // the existing draft stays off the list
    expect(await verifyAuditChain(getAdminPool())).toMatchObject({ ok: true })

    // Re-running changes nothing.
    expect(await importResearch(getAdminPool(), records)).toMatchObject({ universitiesCreated: 0, universitiesExisting: 7, sourcesCreated: 0 })
    expect(await rows("SELECT id FROM universities WHERE destination_iso2 = 'FI'")).toHaveLength(7)
  })

  it('shows imported universities publicly only after a reviewer verifies and publishes them, 5 at a time', async () => {
    const imported = await rows("SELECT id, source_id FROM universities WHERE destination_iso2 = 'FI' AND publication_status = 'in_review' ORDER BY id")
    for (const u of imported) {
      await W.transitionRecord(getAdminPool(), reviewer, 'university', Number(u.id), 'verify', form({ verificationStatus: 'verified', sourceId: String(u.source_id), checkedAt: TODAY, reviewDueAt: '2099-01-01' }))
      await W.transitionRecord(getAdminPool(), reviewer, 'university', Number(u.id), 'publish', form({}))
    }
    const first = await fetchDirectoryPage(getPool(), 'FI', TODAY, 0)
    const second = await fetchDirectoryPage(getPool(), 'FI', TODAY, 5)
    expect(first.total).toBe(6)
    expect(first.entries.map((u) => u.name)).toEqual([1, 2, 3, 4, 5].map((n) => `Synthetic Research University 0${n}`))
    expect(second.entries.map((u) => u.name)).toEqual(['Synthetic Research University 06'])
    // The course, fee and intake are still waiting for their own review, so none is shown.
    const head = first.entries[0]
    if (head.listing !== 'verified') throw new Error('expected a verified entry')
    expect(head.courses).toEqual([])
  })
})

describe('universities-only import with recorded website checks', () => {
  it('adds no course, campus, intake or fee, and replays recorded labels and dates without fetching', async () => {
    const before = await db.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM courses) AS c, (SELECT COUNT(*) FROM tuition_fees) AS f')
    const records = [fullRecord(81), record(82)]
    const [checked, held] = records.map((r) => planRecord(r).university!.row) as Array<{ destination_iso2: string; slug: string }>
    const identity = new Map([
      [`${checked.destination_iso2}:${checked.slug}`, { name: 'Recorded Name', heldNote: null, listing: { provisional_listing: 1, identity_checked_at: '2026-10-27', identity_city_confirmed: 0, identity_evidence: 'Recorded evidence' } }],
      [`${held.destination_iso2}:${held.slug}`, { heldNote: 'Not listed provisionally: site unreachable.', listing: { provisional_listing: 0 } }],
    ])
    const check = vi.fn()
    const summary = await importResearch(getAdminPool(), records, { checkWebsite: check, universitiesOnly: true, identity })
    expect(check).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ universitiesCreated: 2, coursesCreated: 0, campusesCreated: 0, intakesCreated: 0, feesCreated: 0, failed: [] })
    const after = await db.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM courses) AS c, (SELECT COUNT(*) FROM tuition_fees) AS f')
    expect(after[0]).toEqual(before[0])
    const [[row]] = await db.query<RowDataPacket[]>('SELECT name, provisional_listing, identity_checked_at, verification_status, publication_status FROM universities WHERE slug = ?', [checked.slug])
    expect(row).toMatchObject({ name: 'Recorded Name', provisional_listing: 1, verification_status: 'unverified', publication_status: 'in_review' })
    expect(String(row.identity_checked_at).slice(0, 10)).toBe('2026-10-27')
    const [[other]] = await db.query<RowDataPacket[]>('SELECT verification_notes FROM universities WHERE slug = ?', [held.slug])
    expect(other.verification_notes).toContain('Not listed provisionally: site unreachable.')
  })

  it('refuses a university with no recorded check instead of guessing its label', async () => {
    const summary = await importResearch(getAdminPool(), [record(83)], { universitiesOnly: true, identity: new Map() })
    expect(summary.universitiesCreated).toBe(0)
    expect(summary.failed[0]).toContain('no recorded identity check')
  })
})
