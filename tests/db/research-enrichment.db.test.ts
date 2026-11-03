// scripts/import-research.mjs --enrich against a real database, with SYNTHETIC programme research.
// Enrichment adds quoted, programme-level facts to universities that already exist; it never
// overwrites, never duplicates on re-run, never copies one programme's fee or requirement to
// another, and leaves everything new unverified and in review.
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { enrichUniversities, evidenceProblem, planProgramme } from '../../scripts/import-research.mjs'

const { verifyAuditChain } = await import('@/lib/admin/audit')
const { getAdminPool } = await import('@/lib/db/pool')

let server: TestDatabase
let db: Connection
const rows = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0]
const page = 'https://u1.example.edu/study/msc-cs'
const fact = (extra: Record<string, unknown> = {}) => ({ sourceUrl: page, checkedAt: '2026-10-26', quote: 'Standard period of study 4 semesters, taught in English.', ...extra })
const programme = (slug: string, extra: Record<string, unknown> = {}) => ({
  name: `MSc ${slug}`, slug, qualification: 'master', studyLevel: 'PG', durationMonths: 24, studyMode: 'full_time', teachingLanguage: 'English', url: page,
  evidence: fact({ publisher: 'Synthetic University' }),
  ...extra,
})

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  process.env.DATABASE_URL = server.url
  const [src] = await db.query("INSERT INTO sources (url, title, publisher, source_type) VALUES ('https://u1.example.edu/', 'Home', 'Synthetic University', 'university_official')")
  const sourceId = (src as { insertId: number }).insertId
  await db.query("INSERT INTO universities (destination_iso2, slug, name, official_website, source_id) VALUES ('DE', 'synthetic-u1', 'Synthetic University', 'https://u1.example.edu/', ?)", [sourceId])
  const [[u]] = await db.query<RowDataPacket[]>("SELECT id FROM universities WHERE slug = 'synthetic-u1'")
  // An existing course with one requirement filled in, and a verified course nobody may touch.
  await db.query("INSERT INTO courses (university_id, slug, name, qualification, study_level, entry_requirements, source_id) VALUES (?, 'existing', 'Existing MSc', 'master', 'PG', 'Original entry text', ?)", [u.id, sourceId])
}, 240_000)

afterAll(async () => {
  await getAdminPool().end().catch(() => {})
  await db?.end()
  await server?.stop()
})

describe('enrichment evidence rules', () => {
  it('needs a verbatim quote from a specific official page with a check date', () => {
    expect(evidenceProblem(fact())).toBeNull()
    expect(evidenceProblem(fact({ quote: 'short' }))).toBe('no verbatim quote')
    expect(evidenceProblem(fact({ sourceUrl: 'https://u1.example.edu/' }))).toBe('source is not a specific page')
    expect(evidenceProblem(fact({ checkedAt: 'recently' }))).toBe('no check date')
  })

  it('keeps each fee and intake with its own programme, and refuses zero or unexplained missing fees', () => {
    const plan = planProgramme(
      programme('msc-a', {
        fees: [
          { ...fact(), category: 'international', amount: '1500.00', currency: 'EUR', billingPeriod: 'per_semester', academicYear: null, notes: 'Tuition only.' },
          { ...fact(), category: 'international', amount: '0', currency: 'EUR', billingPeriod: 'per_semester', academicYear: null, notes: 'Free' },
          { ...fact(), category: 'international', amount: null, currency: 'EUR', billingPeriod: 'per_semester', academicYear: null },
          { ...fact({ sourceUrl: 'https://u1.example.edu/' }), category: 'international', amount: '900.00', currency: 'EUR', billingPeriod: 'per_semester', academicYear: null },
        ],
        intakes: [{ ...fact(), month: 10, year: null, applicationDeadline: null }, { ...fact(), month: 13, year: null, applicationDeadline: null }],
      }),
    )
    expect(plan.fees.map((f) => f.row.amount)).toEqual(['1500.00'])
    expect(plan.intakes.map((i) => i.row.intake_month)).toEqual([10])
    expect(plan.skipped).toEqual([
      'msc-a intake: invalid month, year or deadline',
      expect.stringMatching(/msc-a fee: invalid amount \(record no tuition as amount null with a note, never 0\)/),
      expect.stringMatching(/msc-a fee: invalid a missing amount needs a note/),
      'msc-a fee: source is not a specific page',
    ])
    expect(planProgramme(programme('msc-b', { evidence: fact({ quote: '' }) })).course).toBeNull()
  })
})

describe('enrichment import', () => {
  const research = [
    {
      destinationIso2: 'DE',
      slug: 'synthetic-u1',
      programmes: [
        programme('msc-new', {
          campus: 'North Campus',
          languageRequirements: { ...fact({ quote: 'IELTS with an overall score of at least 6.5.' }), value: 'IELTS 6.5' },
          intakes: [{ ...fact(), month: 10, year: null, applicationDeadline: null }],
          fees: [{ ...fact(), category: 'international', amount: '1500.00', currency: 'EUR', billingPeriod: 'per_semester', academicYear: null, notes: 'Tuition only.' }],
        }),
        programme('existing', {
          entryRequirements: { ...fact(), value: 'Replacement entry text' },
          languageRequirements: { ...fact({ quote: 'TOEFL iBT with at least 90 points.' }), value: 'TOEFL 90' },
        }),
      ],
    },
    { destinationIso2: 'DE', slug: 'not-in-database', programmes: [programme('msc-x')] },
  ]

  it('adds quoted programmes to existing universities for review, filling only empty fields', async () => {
    const summary = await enrichUniversities(getAdminPool(), research)
    expect(summary).toMatchObject({ universitiesEnriched: 1, universitiesMissing: ['DE:not-in-database'], coursesCreated: 1, coursesExisting: 1, requirementsAdded: 1, campusesCreated: 1, intakesCreated: 1, feesCreated: 1, failed: [] })
    const [existing] = await rows("SELECT entry_requirements, language_requirements FROM courses WHERE slug = 'existing'")
    expect(existing).toEqual({ entry_requirements: 'Original entry text', language_requirements: 'TOEFL 90' }) // never overwritten
    const [created] = await rows("SELECT id, publication_status, verification_status, language_requirements, verification_notes FROM courses WHERE slug = 'msc-new'")
    expect(created).toMatchObject({ publication_status: 'in_review', verification_status: 'unverified', language_requirements: 'IELTS 6.5' })
    expect(created.verification_notes).toMatch(/^Imported research lead, NOT verified\. Official page checked 2026-10-26: "/)
    // The fee and intake belong to msc-new only; the existing course gets none.
    expect(await rows('SELECT course_id FROM tuition_fees')).toEqual([{ course_id: created.id }])
    expect(await rows('SELECT course_id FROM course_intakes')).toEqual([{ course_id: created.id }])
    for (const table of ['courses', 'campuses', 'course_intakes', 'tuition_fees'])
      expect(await rows(`SELECT id FROM ${table} WHERE verification_status <> 'unverified' OR publication_status = 'published'`), table).toHaveLength(0)
    expect(await verifyAuditChain(getAdminPool())).toMatchObject({ ok: true })
  })

  it('changes nothing when run again', async () => {
    const summary = await enrichUniversities(getAdminPool(), research)
    expect(summary).toMatchObject({ universitiesEnriched: 0, coursesCreated: 0, coursesExisting: 2, requirementsAdded: 0, campusesCreated: 0, intakesCreated: 0, intakesExisting: 1, feesCreated: 0, feesExisting: 1, sourcesCreated: 0 })
    expect(await rows('SELECT id FROM tuition_fees')).toHaveLength(1)
  })

  it('never edits a course a reviewer has verified', async () => {
    await db.query("UPDATE courses SET language_requirements = NULL, verification_status = 'verified', checked_at = '2026-10-26', verified_at = '2026-10-26 00:00:00', verified_by = 'u-reviewer', review_due_at = '2027-04-26' WHERE slug = 'existing'")
    const summary = await enrichUniversities(getAdminPool(), research)
    expect(summary.requirementsAdded).toBe(0)
    expect((await rows("SELECT language_requirements FROM courses WHERE slug = 'existing'"))[0].language_requirements).toBeNull()
  })
})
