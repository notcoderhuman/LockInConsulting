// Migration 0013 and the admin data tools (bulk import, duplicates, conflicts, bulk verification,
// academic years) against a real database. Synthetic data only. Run with `pnpm test:db`.
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { todayIso } from '@/lib/data/publication'

const W = await import('@/lib/admin/workflow')
const T = await import('@/lib/admin/data-tools')
const { verifyAuditChain } = await import('@/lib/admin/audit')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
type AdminActor = import('@/lib/admin/roles').AdminActor

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const addDays = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const owner: AdminActor = { userId: 'u-owner', name: 'Owner', email: 'owner@test.example', role: 'owner' }
const reviewer: AdminActor = { userId: 'u-reviewer', name: 'Reviewer', email: 'reviewer@test.example', role: 'reviewer' }
const editor: AdminActor = { userId: 'u-editor', name: 'Editor', email: 'editor@test.example', role: 'editor' }

const form = (fields: Record<string, string | undefined>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v)
  return f
}
async function rows<R = RowDataPacket>(sql: string, params: unknown[] = []): Promise<R[]> {
  const [r] = await db.query<RowDataPacket[]>(sql, params)
  return r as R[]
}
const checkViolation = /check constraint|CONSTRAINT `\w+` failed/i
const src = (n: number | string) => ({ url: `https://official.example/page-${n}`, title: `Official page ${n}`, publisher: 'Example University (synthetic)', sourceType: 'university_official' })
const file = (universities: unknown[]) => JSON.stringify({ format: 'lockin-import@1', universities })

beforeAll(async () => {
  server = await startTestDatabase()
  console.info(`[db] data-tools suite running on ${server.engine}`)
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  Object.assign(process.env, { DATABASE_URL: server.url, BETTER_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'), BETTER_AUTH_URL: 'http://localhost:3000' })
}, 240_000)

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

describe('migration 0013', () => {
  it('adds the provenance columns and tables, and keeps change-log types in sync', async () => {
    const cols = await rows<{ c: string }>("SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('admissions_url', 'institution_subtype', 'other_language_requirements', 'attribution_url')")
    // The public ranking view also carries attribution_url, so the licence link can be shown with every rank.
    expect(cols.map((r) => r.c).sort()).toEqual(['courses.other_language_requirements', 'public_qs_directory.attribution_url', 'public_university_rankings.attribution_url', 'ranking_providers.attribution_url', 'universities.admissions_url', 'universities.institution_subtype'])
    const tables = await rows<{ t: string }>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('academic_years', 'field_sources', 'data_conflicts', 'import_batches') ORDER BY t")
    expect(tables.map((r) => r.t)).toEqual(['academic_years', 'data_conflicts', 'field_sources', 'import_batches'])
    const [entity] = await rows<{ COLUMN_TYPE: string }>("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'data_change_log' AND COLUMN_NAME = 'entity_type'")
    for (const t of ['academic_year', 'field_source', 'data_conflict', 'import_batch']) expect(entity.COLUMN_TYPE).toContain(`'${t}'`)
    // No new triggers: the 14 append-only triggers are unchanged.
    expect(await rows('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()')).toHaveLength(14)
  })

  it('records QS conditional acceptance, never shows it, and requires its reference, date and notes', async () => {
    const [qs] = await rows<{ id: number }>("SELECT id FROM ranking_providers WHERE slug = 'qs'")
    await expect(db.query("UPDATE ranking_providers SET rights_status = 'conditional' WHERE id = ?", [qs.id])).rejects.toThrow(checkViolation)
    await W.updateRankingRights(getAdminPool(), owner, qs.id, form({
      rightsStatus: 'conditional',
      licenceReference: 'Email from ranking@qs.com, 2 Nov 2026 (synthetic test)',
      rightsCheckedAt: TODAY,
      rightsNotes: 'Conditional acceptance pending formal agreement.',
      attributionText: 'Source: QS Quacquarelli Symonds (www.topuniversities.com). With permission.',
      attributionUrl: 'https://www.topuniversities.com/world-university-rankings',
      reason: 'Test',
    }))
    const [p] = await rows<{ rights_status: string; attribution_url: string }>('SELECT rights_status, attribution_url FROM ranking_providers WHERE id = ?', [qs.id])
    expect(p).toEqual({ rights_status: 'conditional', attribution_url: 'https://www.topuniversities.com/world-university-rankings' })
    // Ordering or AI use is refused without a full licence.
    await expect(W.updateRankingRights(getAdminPool(), owner, qs.id, form({ rightsStatus: 'conditional', licenceReference: 'x', rightsCheckedAt: TODAY, rightsNotes: 'x', allowAiUse: 'on' }))).rejects.toThrow(/highlighted/)
    // The public ranking view only ever returns licensed or not-required providers.
    const [view] = await rows<{ VIEW_DEFINITION: string }>("SELECT VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'public_university_rankings'")
    expect(view.VIEW_DEFINITION).not.toMatch(/conditional/)
  })

  it('never lets a secondary source verify a field, and allows only one current academic year', async () => {
    const [s] = await rows<{ id: number }>('SELECT id FROM sources LIMIT 1').then(async (r) => (r.length ? r : (await db.query("INSERT INTO sources SET url = 'https://wiki.example/x', title = 'x', publisher = 'x', source_type = 'other'"), rows<{ id: number }>('SELECT id FROM sources LIMIT 1'))))
    await expect(db.query("INSERT INTO field_sources SET entity_type = 'university', entity_id = 1, field_name = 'city', source_id = ?, accessed_on = ?, method = 'secondary_discovery', status = 'verified', verified_at = NOW(), verified_by = 'x'", [s.id, TODAY])).rejects.toThrow(checkViolation)
    await db.query("INSERT INTO academic_years SET code = '2030-2031', starts_on = '2030-09-01', ends_on = '2031-08-31', is_current = 1")
    await expect(db.query("INSERT INTO academic_years SET code = '2031-2032', starts_on = '2031-09-01', ends_on = '2032-08-31', is_current = 1")).rejects.toThrow(/duplicate/i)
    await expect(db.query("INSERT INTO academic_years SET code = '2031-2033', starts_on = '2031-09-01', ends_on = '2032-08-31'")).rejects.toThrow(checkViolation)
    await db.query("DELETE FROM academic_years WHERE code = '2030-2031'")
  })
})

describe('academic years', () => {
  it('lets only the Owner manage them, with one current year', async () => {
    const pool = getAdminPool()
    await expect(T.saveAcademicYear(pool, reviewer, form({ code: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-08-31' }))).rejects.toThrow(/permission/)
    await T.saveAcademicYear(pool, owner, form({ code: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-08-31', isCurrent: 'on' }))
    await T.saveAcademicYear(pool, owner, form({ code: '2027-2028', startsOn: '2027-09-01', endsOn: '2028-08-31', isCurrent: 'on' }))
    expect(await rows("SELECT code FROM academic_years WHERE is_current = 1")).toEqual([{ code: '2027-2028' }])
    await expect(T.saveAcademicYear(pool, owner, form({ code: '2026-2028', startsOn: '2026-09-01', endsOn: '2027-08-31' }))).rejects.toMatchObject({ fieldErrors: { code: expect.any(Array) } })
  })
})

describe('bulk import', () => {
  const uni = (n: string, extra: Record<string, unknown> = {}) => ({ destinationIso2: 'FI', name: `Synthetic University of ${n}`, officialWebsite: `https://${n.toLowerCase()}.example/`, city: n, source: src(n), ...extra })

  it('creates draft, unverified records with sources, and refuses the same file twice', async () => {
    const text = file([
      uni('Alpha', {
        institutionType: 'public', institutionSubtype: 'research_university', admissionsUrl: 'https://alpha.example/admissions',
        courses: [{
          name: 'MSc Synthetic Data', qualification: 'master', studyLevel: 'PG', durationMonths: 24, courseUrl: 'https://alpha.example/msc',
          intakes: [{ month: 9, year: 2027, applicationDeadline: '2027-01-15' }],
          fees: [{ category: 'international', amount: 15000, currency: 'EUR', billingPeriod: 'per_year', academicYear: '2027-2028', source: src('alpha-fees') }],
        }],
      }),
      uni('Beta'),
    ])
    const summary = await T.importRecords(getAdminPool(), editor, 'batch-1.json', text)
    expect(summary).toMatchObject({ universitiesCreated: 2, coursesCreated: 1, intakesCreated: 1, feesCreated: 1, matchedExisting: 0, conflicts: 0 })
    const created = await rows<{ publication_status: string; verification_status: string; source_id: number }>("SELECT publication_status, verification_status, source_id FROM universities WHERE name LIKE 'Synthetic University of %'")
    expect(created).toHaveLength(2)
    for (const r of created) expect(r).toMatchObject({ publication_status: 'draft', verification_status: 'unverified' })
    const [fee] = await rows<{ amount: string; verification_status: string; url: string }>('SELECT f.amount, f.verification_status, s.url FROM tuition_fees f JOIN sources s ON s.id = f.source_id')
    expect(fee).toEqual({ amount: '15000.00', verification_status: 'unverified', url: 'https://official.example/page-alpha-fees' })
    await expect(T.importRecords(getAdminPool(), editor, 'again.json', text)).rejects.toThrow(/already imported/)
    expect(await rows('SELECT id FROM import_batches')).toHaveLength(1)
  })

  it('validates the whole file first and writes nothing when anything is wrong', async () => {
    const before = await rows('SELECT id FROM universities')
    const bad = file([uni('Gamma'), { destinationIso2: 'XX', name: 'Nowhere', source: src('x') }, uni('Delta', { courses: [{ name: 'BSc', qualification: 'master', studyLevel: 'UG' }] })])
    await expect(T.importRecords(getAdminPool(), editor, 'bad.json', bad)).rejects.toMatchObject({ blockers: expect.arrayContaining([expect.stringMatching(/universities\[1\]\.destinationIso2/), expect.stringMatching(/courses\[0\]\.qualification/)]) })
    await expect(T.importRecords(getAdminPool(), editor, 'year.json', file([uni('Epsilon', { courses: [{ name: 'MA X', qualification: 'master', studyLevel: 'PG', fees: [{ amount: 1, currency: 'EUR', billingPeriod: 'per_year', academicYear: '2040-2041' }] }] })]))).rejects.toMatchObject({ blockers: [expect.stringMatching(/not in the academic-year list/)] })
    await expect(T.importRecords(getAdminPool(), editor, 'nojson.json', '{')).rejects.toThrow(/problem/)
    // A verification status in the file is ignored: imports are always drafts.
    expect(await rows('SELECT id FROM universities')).toHaveLength(before.length)
  })

  it('never overwrites an existing record: a match by name records one conflict per differing field', async () => {
    const summary = await T.importRecords(getAdminPool(), editor, 'batch-2.json', file([uni('Alpha', { slug: 'another-slug', name: 'The Synthetic University of Alpha', city: 'Elsewhere', officialWebsite: 'https://alpha.example/' })]))
    expect(summary).toMatchObject({ universitiesCreated: 0, matchedExisting: 1 })
    const conflicts = await rows<{ field_name: string; current_value: string; proposed_value: string }>("SELECT field_name, current_value, proposed_value FROM data_conflicts WHERE kind = 'field_value' ORDER BY field_name")
    expect(conflicts).toEqual([
      { field_name: 'city', current_value: 'Alpha', proposed_value: 'Elsewhere' },
      { field_name: 'name', current_value: 'Synthetic University of Alpha', proposed_value: 'The Synthetic University of Alpha' },
    ])
    expect(await rows("SELECT city FROM universities WHERE slug = 'synthetic-university-of-alpha'")).toEqual([{ city: 'Alpha' }])
  })

  it('records a pending field source for a field taken from another page, and rejects unknown or empty fields', async () => {
    const summary = await T.importRecords(getAdminPool(), editor, 'fields.json', file([
      uni('Theta', {
        admissionsUrl: 'https://theta.example/apply', fieldSources: { admissionsUrl: src('theta-apply') },
        courses: [{ name: 'MSc Theta', qualification: 'master', studyLevel: 'PG', languageRequirements: 'IELTS 6.5', fieldSources: { languageRequirements: src('theta-lang') },
          fees: [{ amount: 9000, currency: 'EUR', billingPeriod: 'per_year', fieldSources: { amount: src('theta-fee') } }] }],
      }),
    ]))
    expect(summary).toMatchObject({ universitiesCreated: 1, coursesCreated: 1, feesCreated: 1 })
    const fs = await rows<{ entity_type: string; field_name: string; status: string; method: string; url: string }>(
      "SELECT f.entity_type, f.field_name, f.status, f.method, s.url FROM field_sources f JOIN sources s ON s.id = f.source_id WHERE s.url LIKE '%theta-%' ORDER BY f.field_name",
    )
    expect(fs).toEqual([
      { entity_type: 'university', field_name: 'admissions_url', status: 'pending', method: 'official_page', url: 'https://official.example/page-theta-apply' },
      { entity_type: 'tuition_fee', field_name: 'amount', status: 'pending', method: 'official_page', url: 'https://official.example/page-theta-fee' },
      { entity_type: 'course', field_name: 'language_requirements', status: 'pending', method: 'official_page', url: 'https://official.example/page-theta-lang' },
    ])
    await expect(T.importRecords(getAdminPool(), editor, 'badfields.json', file([uni('Iota', { fieldSources: { nonsense: src('x'), admissionsUrl: src('y') } })]))).rejects.toMatchObject({
      blockers: [expect.stringMatching(/fieldSources\.nonsense: not a field/), expect.stringMatching(/fieldSources\.admissionsUrl: the record has no value/)],
    })
  })

  it('imports ranks as drafts only while the provider is conditional or licensed, never visible', async () => {
    const rank = (n: string, extra: Record<string, unknown> = {}) => uni(n, { rankings: [{ provider: 'qs', year: 2027, position: 150, source: { ...src(`${n}-qs`), sourceType: 'ranking_provider' } }], ...extra })
    const [qs] = await rows<{ id: number; rights_status: string }>("SELECT id, rights_status FROM ranking_providers WHERE slug = 'qs'")
    const pool = getAdminPool()
    await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed' WHERE id = ?", [qs.id])
    await expect(T.importRecords(pool, editor, 'qs-early.json', file([rank('Kappa')]))).rejects.toMatchObject({ blockers: [expect.stringMatching(/reuse rights are "not_confirmed"/)] })
    await expect(T.importRecords(pool, editor, 'qs-nosrc.json', file([uni('Kappa', { rankings: [{ provider: 'qs', year: 2027, position: 150 }] })]))).rejects.toMatchObject({ blockers: [expect.stringMatching(/rankings\[0\]\.source/)] })
    await expect(T.importRecords(pool, editor, 'qs-unknown.json', file([uni('Kappa', { rankings: [{ provider: 'nope', year: 2027, position: 1, source: src('n') }] })]))).rejects.toMatchObject({ blockers: [expect.stringMatching(/no ranking provider with the code "nope"/)] })
    expect(await rows("SELECT id FROM universities WHERE name = 'Synthetic University of Kappa'")).toHaveLength(0)

    await W.updateRankingRights(pool, owner, qs.id, form({ rightsStatus: 'conditional', licenceReference: 'Synthetic email', rightsCheckedAt: TODAY, rightsNotes: 'Formal agreement pending' }))
    const summary = await T.importRecords(pool, editor, 'qs.json', file([rank('Kappa')]))
    expect(summary).toMatchObject({ universitiesCreated: 1, rankingsCreated: 1 })
    const [r] = await rows<{ id: number; rank_position: number; publication_status: string; verification_status: string; source_type: string }>(
      "SELECT r.id, r.rank_position, r.publication_status, r.verification_status, s.source_type FROM university_rankings r JOIN sources s ON s.id = r.source_id JOIN universities u ON u.id = r.university_id WHERE u.name = 'Synthetic University of Kappa'",
    )
    expect(r).toMatchObject({ rank_position: 150, publication_status: 'draft', verification_status: 'unverified', source_type: 'ranking_provider' })
    expect(await rows('SELECT id FROM public_university_rankings WHERE id = ?', [r.id])).toHaveLength(0)
    // The same rank again is skipped with a note, not duplicated.
    const again = await T.importRecords(pool, editor, 'qs-again.json', `${file([rank('Kappa')])} `) // trailing space: a different file hash
    expect(again).toMatchObject({ rankingsCreated: 0, matchedExisting: 1, notes: [expect.stringMatching(/rank already exists/)] })
    await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed' WHERE id = ?", [qs.id])
  })

  it('refuses import without capture permission', async () => {
    await expect(T.importRecords(getAdminPool(), { ...editor, role: 'nobody' as never }, 'x.json', file([uni('Zeta')]))).rejects.toThrow(/permission/)
  })
})

describe('duplicates and conflicts', () => {
  it('finds duplicates by normalised name or website host, once', async () => {
    expect(T.normaliseName('  The Université de Sûreté & Co. ')).toBe('universite de surete and co')
    expect(T.findDuplicatePairs([
      { id: 1, destinationIso2: 'FI', name: 'Aalto University', officialWebsite: 'https://www.aalto.fi/' },
      { id: 2, destinationIso2: 'FI', name: 'Aalto-University', officialWebsite: null },
      { id: 3, destinationIso2: 'FI', name: 'Other', officialWebsite: 'https://aalto.fi/en' },
      { id: 4, destinationIso2: 'DE', name: 'Aalto University', officialWebsite: null },
    ])).toEqual([{ a: 1, b: 2, reason: 'same name' }, { a: 1, b: 3, reason: 'same website (aalto.fi)' }])

    const pool = getAdminPool()
    await W.createRecord(pool, editor, 'university', form({ name: 'Synthetic University of Beta (copy)', slug: 'beta-copy', destinationIso2: 'FI', officialWebsite: 'https://www.beta.example/x' }), null)
    expect(await T.scanDuplicates(pool, editor)).toBe(1)
    expect(await T.scanDuplicates(pool, editor)).toBe(0)
  })

  it('lets a reviewer resolve conflicts with a reason; accepting a value edits the draft and resets verification', async () => {
    const pool = getAdminPool()
    const [city] = await rows<{ id: number; entity_id: number }>("SELECT id, entity_id FROM data_conflicts WHERE field_name = 'city'")
    await expect(T.resolveConflict(pool, editor, city.id, form({ outcome: 'accepted_proposed', note: 'Checked' }))).rejects.toThrow(/permission/)
    await expect(T.resolveConflict(pool, reviewer, city.id, form({ outcome: 'accepted_proposed', note: '' }))).rejects.toMatchObject({ fieldErrors: { note: expect.any(Array) } })
    await expect(T.resolveConflict(pool, reviewer, city.id, form({ outcome: 'not_duplicate', note: 'Wrong outcome for a field conflict.' }))).rejects.toThrow(/valid outcome/)
    await T.resolveConflict(pool, reviewer, city.id, form({ outcome: 'accepted_proposed', note: 'The official page names Elsewhere.' }))
    expect(await rows('SELECT city, verification_status FROM universities WHERE id = ?', [city.entity_id])).toEqual([{ city: 'Elsewhere', verification_status: 'unverified' }])
    expect(await rows("SELECT field_name, status FROM field_sources WHERE entity_type = 'university' AND entity_id = ?", [city.entity_id])).toEqual([{ field_name: 'city', status: 'pending' }])
    await expect(T.resolveConflict(pool, reviewer, city.id, form({ outcome: 'kept_current', note: 'again' }))).rejects.toThrow(/already resolved/)

    const [name] = await rows<{ id: number }>("SELECT id FROM data_conflicts WHERE field_name = 'name'")
    await T.resolveConflict(pool, reviewer, name.id, form({ outcome: 'kept_current', note: 'The registered name has no "The".' }))
    const [dup] = await rows<{ id: number }>("SELECT id FROM data_conflicts WHERE kind = 'duplicate'")
    await T.resolveConflict(pool, reviewer, dup.id, form({ outcome: 'not_duplicate', note: 'Separate institution (synthetic).' }))
    expect(await rows("SELECT id FROM data_conflicts WHERE status = 'open'")).toHaveLength(0)
  })
})

describe('bulk verification', () => {
  it('is Owner-only, uses each record’s own source and the normal verify step, and reports refusals', async () => {
    const pool = getAdminPool()
    const ids = (await rows<{ id: number }>("SELECT id FROM universities WHERE name LIKE 'Synthetic University of %' AND source_id IS NOT NULL ORDER BY id")).map((r) => r.id)
    const noSource = await W.createRecord(pool, editor, 'university', form({ name: 'No Source University', slug: 'no-source', destinationIso2: 'FI' }), null)
    for (const id of [...ids, noSource]) await W.transitionRecord(pool, editor, 'university', id, 'submit_for_review', form({}))
    const verifyForm = form({ checkedAt: TODAY, reviewDueAt: addDays(180) })

    await expect(T.bulkVerify(pool, reviewer, 'university', ids, verifyForm)).rejects.toThrow(/permission/)
    await expect(T.bulkVerify(pool, owner, 'university', Array.from({ length: 101 }, (_, i) => i + 1), verifyForm)).rejects.toThrow(/at most 100/)

    const results = await T.bulkVerify(pool, owner, 'university', [...ids, noSource, 999999], verifyForm)
    expect(results.filter((r) => r.ok).map((r) => r.id)).toEqual(ids)
    expect(results.find((r) => r.id === noSource)).toMatchObject({ ok: false, message: expect.stringMatching(/No source/) })
    expect(results.find((r) => r.id === 999999)).toMatchObject({ ok: false, message: 'Not found.' })
    const verified = await rows<{ verification_status: string; verified_by: string; publication_status: string }>('SELECT verification_status, verified_by, publication_status FROM universities WHERE id IN (?)', [ids])
    for (const v of verified) expect(v).toEqual({ verification_status: 'verified', verified_by: owner.userId, publication_status: 'in_review' })
    // An invalid review date is refused per record, nothing changes.
    const bad = await T.bulkVerify(pool, owner, 'university', [noSource], form({ checkedAt: TODAY, reviewDueAt: '' }))
    expect(bad[0].ok).toBe(false)
  })

  it('keeps the audit chain intact after every tool', async () => {
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true })
    const actions = await rows<{ action: string }>("SELECT DISTINCT action FROM data_change_log WHERE entity_type IN ('import_batch', 'data_conflict', 'academic_year') ORDER BY action")
    expect(actions.map((a) => a.action)).toEqual(['create', 'import', 'resolve_conflict'])
  })
})

describe('import duplicates inside one file', () => {
  it('refuses a file that lists the same course twice for one university, writing nothing', async () => {
    const before = await rows('SELECT id FROM courses')
    const course = { name: 'MSc Twice', qualification: 'master', studyLevel: 'PG' }
    const text = file([{ destinationIso2: 'PL', name: 'Synthetic Twice University', officialWebsite: 'https://twice.example/', source: src('twice'), courses: [course, course] }])
    await expect(T.importRecords(getAdminPool(), editor, 'twice.json', text)).rejects.toMatchObject({ blockers: [expect.stringMatching(/msc-twice twice/)] })
    expect(await rows('SELECT id FROM courses')).toHaveLength(before.length)
    expect(await rows("SELECT id FROM universities WHERE slug = 'synthetic-twice-university'")).toHaveLength(0)
  })

  it('matches a second entry with the same name but another slug to the first, instead of creating a duplicate', async () => {
    const text = file([
      { destinationIso2: 'PL', name: 'Synthetic Pair University', slug: 'pair-one', city: 'Kraków', source: src('pair-1') },
      { destinationIso2: 'PL', name: 'Synthetic Pair University', slug: 'pair-two', city: 'Kraków', subRegion: 'Lesser Poland', source: src('pair-2') },
    ])
    const summary = await T.importRecords(getAdminPool(), editor, 'pair.json', text)
    // Compared with the full stored first row: the same city is no conflict; only the new sub-region is.
    expect(summary).toMatchObject({ universitiesCreated: 1, matchedExisting: 1, conflicts: 1 })
    expect(await rows("SELECT field_name FROM data_conflicts WHERE detail LIKE 'Bulk import%' AND proposed_value = 'Lesser Poland'")).toEqual([{ field_name: 'sub_region' }])
    expect(await rows("SELECT slug FROM universities WHERE name = 'Synthetic Pair University'")).toEqual([{ slug: 'pair-one' }])
  })
})
