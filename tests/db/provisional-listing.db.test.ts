// Provisional ("Not yet verified") university entries, D-043, against a real database. Synthetic data.
// Provisional entries expose identity only; verifying and publishing turns the SAME row into a full
// listing (one card, same id). Every candidate in review is listed (D-044): unchecked, stale or
// non-university records by name only, with their status; drafts being edited and hidden records are not;
// every destination pages 5 at a time up to 50; QS order and Derek's evidence stay gated.
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { importResearch, judgeWebsite } from '../../scripts/import-research.mjs'
import { todayIso } from '@/lib/data/publication'
import { DESTINATIONS } from '@/lib/destinations'

const W = await import('@/lib/admin/workflow')
const { verifyAuditChain } = await import('@/lib/admin/audit')
const { fetchDirectoryPage } = await import('@/lib/db/directory-queries')
const { loadEvidence } = await import('@/lib/derek/evidence')
const { getAdminPool, getPool } = await import('@/lib/db/pool')
type AdminActor = import('@/lib/admin/roles').AdminActor
type DirectoryEntry = import('@/lib/data/types').DirectoryEntry

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const addDays = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const reviewer: AdminActor = { userId: 'u-reviewer', name: 'Reviewer', email: 'reviewer@test.example', role: 'reviewer' }
const editor: AdminActor = { userId: 'u-editor', name: 'Editor', email: 'editor@test.example', role: 'editor' }
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const rows = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0]
const page = (iso2: string, offset = 0) => fetchDirectoryPage(getPool(), iso2, TODAY, offset)
const idOf = async (slug: string) => Number((await rows('SELECT id FROM universities WHERE slug = ?', [slug]))[0].id)

const quoted = (field: string, value: unknown, sourceUrl: string) => ({
  field, scope: 'course_specific', value, evidence: `Official page: 'Synthetic quoted excerpt for ${field}.'`,
  checkedAt: '2026-10-18', validity: '2026-2027', result: 'captured', sourceUrl, publisher: 'Synthetic Faculty',
})
const record = (iso2: string, n: number, name = `Synthetic University ${iso2} ${String(n).padStart(2, '0')}`, facts: unknown[] = []) => ({
  destinationIso2: iso2,
  officialName: name,
  slug: `prov-${iso2.toLowerCase()}-${n}`,
  institutionType: 'public',
  city: 'Synthville',
  subRegion: null,
  identity: { url: `https://p${n}.${iso2.toLowerCase()}.example.edu/`, method: 'official_website', httpStatus: 200, pageTitle: name, checkedAt: '2026-10-18', result: 'captured' },
  facts,
})
// Stands in for the live website check: the page title names the institution and states the city.
const siteOk = async (r: ReturnType<typeof record>) =>
  judgeWebsite(r, { status: 200, finalUrl: r.identity.url, title: `${r.officialName} | Home`, text: `Welcome to ${r.city}` })
const verifyAndPublish = async (entity: 'university' | 'course', id: number) => {
  const [row] = await rows(`SELECT source_id FROM ${entity === 'university' ? 'universities' : 'courses'} WHERE id = ?`, [id])
  await W.transitionRecord(getAdminPool(), reviewer, entity, id, 'verify', form({ verificationStatus: 'verified', sourceId: String(row.source_id), checkedAt: TODAY, reviewDueAt: addDays(180) }))
  await W.transitionRecord(getAdminPool(), reviewer, entity, id, 'publish', form({}))
}

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

describe('website check (pure)', () => {
  const r = record('DE', 1, 'Example University Leipzig')
  it('accepts a matching https page on the same domain and records what it saw', () => {
    const ok = judgeWebsite(r, { status: 200, finalUrl: 'https://www.p1.de.example.edu/en/', title: 'Home – Example University Leipzig', text: 'Synthville campus' })
    expect(ok).toMatchObject({ ok: true, cityConfirmed: true })
    expect(ok.evidence).toMatch(/answered HTTP 200; page title "Home – Example University Leipzig"; the page names Synthville/)
  })
  it('rejects errors, other domains, plain http and titles that do not name the institution', () => {
    expect(judgeWebsite(r, { status: 403, finalUrl: r.identity.url, title: 'Forbidden', text: '' }).ok).toBe(false)
    expect(judgeWebsite(r, { status: 200, finalUrl: 'https://parked-domains.example.com/', title: 'Example University Leipzig', text: '' }).ok).toBe(false)
    expect(judgeWebsite(r, { status: 200, finalUrl: 'http://p1.de.example.edu/', title: 'Example University Leipzig', text: '' }).ok).toBe(false)
    expect(judgeWebsite(r, { status: 200, finalUrl: r.identity.url, title: 'Just a moment...', text: '' }).ok).toBe(false)
  })
})

describe('provisional listings', () => {
  it('lists checked universities with identity fields only, and keeps non-universities and failed checks for review', async () => {
    const records = [
      record('NZ', 1, 'Synthetic University of Aotearoa', [
        quoted('programme', { name: 'MSc Computer Science', slug: 'msc-cs', qualification: 'master', studyLevel: 'PG', durationMonths: 24, studyMode: 'full_time', campus: null, teachingLanguage: 'English', url: 'https://p1.nz.example.edu/msc' }, 'https://p1.nz.example.edu/msc'),
        quoted('tuition_fee', { currency: 'NZD', amount: '40000.00', billingPeriod: 'per_year', feeCategory: 'international', academicYear: '2026-2027', notes: null }, 'https://p1.nz.example.edu/fees'),
      ]),
      record('NZ', 2, 'Synthetic Polytechnic'),
      record('NZ', 3, 'Synthetic University of Blocked Sites'),
    ]
    const check = async (r: ReturnType<typeof record>) => (r.slug === 'prov-nz-3' ? { ok: false as const, problem: 'website answered HTTP 403' } : siteOk(r))
    const summary = await importResearch(getAdminPool(), records, { checkWebsite: check, today: TODAY })
    expect(summary).toMatchObject({ universitiesCreated: 3, provisional: 1, coursesCreated: 1, feesCreated: 1, failed: [] })
    expect(summary.held).toEqual([
      'NZ:prov-nz-2: institutional category not established (the name does not identify a university)',
      'NZ:prov-nz-3: website answered HTTP 403',
    ])
    // Held records are kept, in review, with the reason for the reviewer.
    const held = await rows("SELECT provisional_listing, publication_status, verification_notes FROM universities WHERE slug IN ('prov-nz-2', 'prov-nz-3') ORDER BY slug")
    expect(held.map((h) => [h.provisional_listing, h.publication_status])).toEqual([[0, 'in_review'], [0, 'in_review']])
    expect(held[0].verification_notes).toMatch(/Not listed provisionally: institutional category not established/)

    const { entries, total, verifiedTotal, otherTotal } = await page('NZ')
    expect({ total, verifiedTotal, otherTotal }).toEqual({ total: 3, verifiedTotal: 0, otherTotal: 1 })
    // Exactly the identity fields: nothing else exists on the object to render. Held candidates are
    // listed by name only (no website, city or date), the polytechnic as another institution type.
    const pending = { listing: 'provisional', identityStatus: 'pending', officialWebsite: null, city: null, identityCheckedAt: null }
    expect(entries).toEqual([
      { ...pending, id: await idOf('prov-nz-2'), slug: 'prov-nz-2', name: 'Synthetic Polytechnic', category: 'other' },
      { listing: 'provisional', id: await idOf('prov-nz-1'), slug: 'prov-nz-1', name: 'Synthetic University of Aotearoa', identityStatus: 'checked', category: 'university', officialWebsite: 'https://p1.nz.example.edu/', city: 'Synthville', identityCheckedAt: TODAY },
      { ...pending, id: await idOf('prov-nz-3'), slug: 'prov-nz-3', name: 'Synthetic University of Blocked Sites', category: 'university' },
    ])
    // The views themselves expose no detail or internal columns, and the pending course and fee stay hidden.
    const [view] = await rows('SELECT * FROM public_provisional_universities')
    expect(Object.keys(view).sort()).toEqual(['city', 'destination_iso2', 'id', 'identity_checked_at', 'identity_status', 'institution_category', 'name', 'official_website', 'slug'])
    expect(await rows('SELECT id FROM public_courses')).toHaveLength(0)
    expect(await rows('SELECT id FROM public_tuition_fees')).toHaveLength(0)
    // Being listed never changes a record's verification or publication status.
    expect(await rows("SELECT id FROM universities WHERE verification_status <> 'unverified' OR publication_status = 'published'")).toHaveLength(0)
  })

  it('becomes a full verified listing in place: same id, one card, details only once approved', async () => {
    const id = await idOf('prov-nz-1')
    await verifyAndPublish('university', id)
    const one = async () => (await page('NZ')).entries.filter((e) => e.id === id)
    const { total, verifiedTotal } = await page('NZ')
    expect({ total, verifiedTotal }).toEqual({ total: 3, verifiedTotal: 1 })
    let entries = await one()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ listing: 'verified', id, slug: 'prov-nz-1', name: 'Synthetic University of Aotearoa' })
    expect((entries[0] as Extract<DirectoryEntry, { listing: 'verified' }>).courses).toEqual([]) // course and fee still in review

    const [course] = await rows('SELECT id FROM courses WHERE university_id = ?', [id])
    await verifyAndPublish('course', Number(course.id))
    entries = await one()
    const verified = entries[0] as Extract<DirectoryEntry, { listing: 'verified' }>
    expect(verified.courses.map((c) => c.name)).toEqual(['MSc Computer Science'])
    expect(verified.courses[0].fees).toEqual([]) // the fee itself is still unverified: never guessed
    expect(await rows('SELECT id FROM universities WHERE slug = ?', ['prov-nz-1'])).toHaveLength(1)
  })

  it('hides withdrawn records, keeps returned-to-draft ones, and withdraws a listing when its details are edited', async () => {
    const records = [record('FI', 1), record('FI', 2), record('FI', 3)]
    await importResearch(getAdminPool(), records, { checkWebsite: siteOk, today: TODAY })
    const names = async () => (await page('FI')).entries.map((e) => e.slug)
    expect(await names()).toEqual(['prov-fi-1', 'prov-fi-2', 'prov-fi-3'])

    // A reviewer rejects one (back to draft): still listed, as the reviewer had listed it.
    await W.transitionRecord(getAdminPool(), reviewer, 'university', await idOf('prov-fi-1'), 'return_to_draft', form({ reason: 'Fees page needs a second look.' }))
    expect(await names()).toContain('prov-fi-1')

    // Editing the name or website withdraws the provisional listing until a reviewer re-checks it.
    await W.updateRecord(getAdminPool(), editor, 'university', await idOf('prov-fi-2'), form({ name: 'Synthetic University FI 02 (renamed)', slug: 'prov-fi-2', destinationIso2: 'FI', officialWebsite: 'https://p2.fi.example.edu/', institutionType: 'public' }))
    expect(await names()).not.toContain('prov-fi-2')

    // A reviewer removes one from the public list; an editor may not change the listing.
    const third = await idOf('prov-fi-3')
    await expect(W.setProvisionalListing(getAdminPool(), editor, third, false, form({ reason: 'Not a university' }))).rejects.toThrow()
    await W.setProvisionalListing(getAdminPool(), reviewer, third, false, form({ reason: 'Website belongs to a different institution.' }))
    expect(await names()).toEqual(['prov-fi-1'])

    // ...and can list it again after checking the website by hand (audited with that evidence).
    await W.setProvisionalListing(getAdminPool(), reviewer, third, true, form({ reason: 'Opened the official website; the name matches.', cityConfirmed: 'on' }))
    expect(await names()).toEqual(['prov-fi-1', 'prov-fi-3'])
    const [log] = await rows("SELECT reason FROM data_change_log WHERE action = 'provisional_change' ORDER BY id DESC LIMIT 1")
    expect(log.reason).toBe('Opened the official website; the name matches.')

    // An identity check older than 180 days no longer counts: name only again, no website.
    await db.query('UPDATE universities SET identity_checked_at = ? WHERE id = ?', [addDays(-181), third])
    expect((await page('FI')).entries.find((e) => e.id === third)).toMatchObject({ identityStatus: 'pending', officialWebsite: null, identityCheckedAt: null })
  })

  it('lets a reviewer remove a name-only candidate from the public directory, audited', async () => {
    await importResearch(getAdminPool(), [record('SA', 900, 'Synthetic University of Unreachable Sites')], { checkWebsite: async () => ({ ok: false, problem: 'website could not be reached (TimeoutError)' }), today: TODAY })
    const id = await idOf('prov-sa-900')
    expect((await page('SA')).entries.find((e) => e.id === id)).toMatchObject({ identityStatus: 'pending', officialWebsite: null })
    await W.setProvisionalListing(getAdminPool(), reviewer, id, false, form({ reason: 'Not a degree-awarding institution.' }))
    expect((await page('SA')).entries.some((e) => e.id === id)).toBe(false)
    const [r] = await rows('SELECT listing_hidden, verification_status, publication_status FROM universities WHERE id = ?', [id])
    expect([r.listing_hidden, r.verification_status, r.publication_status]).toEqual([1, 'unverified', 'in_review'])
  })

  it('cannot be listed provisionally without an official website check, or once published', async () => {
    await expect(db.query("UPDATE universities SET provisional_listing = 1, identity_checked_at = NULL WHERE slug = 'prov-nz-2'")).rejects.toThrow(/constraint/i)
    await expect(W.setProvisionalListing(getAdminPool(), reviewer, await idOf('prov-nz-1'), true, form({ reason: 'Trying to list a published record.' }))).rejects.toThrow(/published record/)
  })

  it('pages every destination 5 at a time, with no duplicates, up to 50', async () => {
    const counts = [0, 1, 4, 5, 6, 10, 12, 49, 50, 53, 7]
    const plan = DESTINATIONS.map((d, i) => ({ iso2: d.iso2, n: counts[i] }))
    expect(plan).toHaveLength(11)
    // Fresh destinations only: earlier tests used NZ and FI.
    await db.query("DELETE FROM course_intakes; DELETE FROM tuition_fees")
    for (const { iso2, n } of plan) {
      const existing = (await page(iso2)).total
      const records = Array.from({ length: n }, (_, i) => record(iso2, 100 + i))
      await importResearch(getAdminPool(), records, { checkWebsite: siteOk, today: TODAY })
      const expected = Math.min(existing + n, 50)
      const seen: number[] = []
      const sizes: number[] = []
      for (let offset = 0; offset < 60; offset += 5) {
        const p = await page(iso2, offset)
        expect(p.total, iso2).toBe(expected)
        if (!p.entries.length) break
        sizes.push(p.entries.length)
        seen.push(...p.entries.map((e) => e.id))
      }
      expect(new Set(seen).size, iso2).toBe(seen.length)
      expect(seen.length, iso2).toBe(expected)
      expect(sizes.slice(0, -1).every((s) => s === 5), iso2).toBe(true)
    }
    // About 4,100 statements: 3 minutes of round trips to a remote server, seconds on a local one.
  }, process.env.DB_TEST_URL ? 300_000 : undefined)

  it('never ranks provisional entries; QS order applies to licensed, verified ranks only', async () => {
    const records = [record('IT', 1, 'Alpha Synthetic University'), record('IT', 2, 'Beta Synthetic University'), record('IT', 3, 'Gamma Synthetic University')]
    await importResearch(getAdminPool(), records, { checkWebsite: siteOk, today: TODAY })
    const gamma = await idOf('prov-it-3')
    await verifyAndPublish('university', gamma)
    const [[qs]] = await db.query<RowDataPacket[]>("SELECT id FROM ranking_providers WHERE slug = 'qs'")
    const [src] = await rows('SELECT source_id FROM universities WHERE id = ?', [gamma])
    await db.query('INSERT INTO university_rankings SET ?', [{ university_id: gamma, provider_id: qs.id, ranking_year: 2026, rank_position: 300, publication_status: 'published', verification_status: 'verified', source_id: src.source_id, checked_at: TODAY, verified_at: `${TODAY} 00:00:00`, verified_by: 'u-reviewer', review_due_at: addDays(90) }])
    const order = async () => (await page('IT')).entries.filter((e) => e.slug.startsWith('prov-it-') && Number(e.slug.split('-')[2]) <= 3).map((e) => e.slug)
    expect(await order()).toEqual(['prov-it-1', 'prov-it-2', 'prov-it-3']) // QS not licensed: by name
    await db.query("UPDATE ranking_providers SET rights_status = 'licensed', licence_reference = 'T', licence_scope = 'test', rights_checked_at = ?, allow_ordering = 1 WHERE id = ?", [TODAY, qs.id])
    try {
      expect(await order()).toEqual(['prov-it-3', 'prov-it-1', 'prov-it-2'])
      const provisional = (await page('IT')).entries.filter((e) => e.listing === 'provisional')
      expect(provisional.every((e) => !('rankings' in e))).toBe(true)
    } finally {
      await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed', licence_reference = NULL, licence_scope = NULL, rights_checked_at = NULL, allow_ordering = 0 WHERE id = ?", [qs.id])
    }
  })

  it('gives Derek no evidence from provisional entries, and keeps the audit chain intact', async () => {
    const evidence = await loadEvidence(getPool(), 'Tell me about Alpha Synthetic University', TODAY)
    expect(evidence.filter((e) => e.text.includes('Alpha Synthetic University'))).toEqual([])
    expect(await verifyAuditChain(getAdminPool())).toMatchObject({ ok: true })
  })
})
