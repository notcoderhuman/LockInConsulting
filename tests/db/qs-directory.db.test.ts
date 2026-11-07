// Migration 0014 and the public QS directory against a real database. Synthetic universities and ranks only.
// Run with `pnpm test:db`.
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { todayIso } from '@/lib/data/publication'

const W = await import('@/lib/admin/workflow')
const T = await import('@/lib/admin/data-tools')
const { verifyAuditChain } = await import('@/lib/admin/audit')
const { fetchQsPage } = await import('@/lib/db/qs-directory-queries')
const { getAdminPool, getAuthPool, getPool } = await import('@/lib/db/pool')
type AdminActor = import('@/lib/admin/roles').AdminActor

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
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
const src = (n: string) => ({ url: `https://official.example/${n}`, title: n, publisher: 'Example (synthetic)', sourceType: 'university_official' })
const qsSource = (n: string) => ({ url: `https://www.topuniversities.com/universities/${n}`, title: `${n}: QS World University Rankings 2027`, publisher: 'QS Quacquarelli Symonds', sourceType: 'ranking_provider' })
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const uni = (name: string, iso2: string, ranking: Record<string, unknown>) => ({
  destinationIso2: iso2,
  name,
  slug: slug(name),
  officialWebsite: `https://www.${slug(name)}.example/`,
  source: src(slug(name)),
  rankings: [{ provider: 'qs', year: 2027, edition: 'QS World University Rankings 2027', source: qsSource(slug(name)), ...ranking }],
})
const file = (universities: unknown[]) => JSON.stringify({ format: 'lockin-import@1', universities })
const attribution = { attributionText: 'Source: QS Quacquarelli Symonds (www.topuniversities.com). With permission.', attributionUrl: 'https://www.topuniversities.com/world-university-rankings' }

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  Object.assign(process.env, { DATABASE_URL: server.url, BETTER_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'), BETTER_AUTH_URL: 'http://localhost:3000' })
}, 240_000)

afterAll(async () => {
  await Promise.allSettled([getAdminPool().end(), getAuthPool().end(), getPool().end()])
  await db?.end()
  await server?.stop()
})

describe('migration 0014 and the rank label', () => {
  it('stores ranks exactly as QS prints them and refuses anything else', async () => {
    const [col] = await rows<{ n: number }>("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'university_rankings' AND COLUMN_NAME = 'rank_label'")
    expect(Number(col.n)).toBe(1)
    expect((await rows("SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'public_qs_directory'")).length).toBe(1)
    // No new triggers: the 14 append-only triggers are unchanged.
    expect(await rows('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()')).toHaveLength(14)
  })

  it('validates labels on import: the number must be the position or the band low end', async () => {
    const pool = getAdminPool()
    await W.updateRankingRights(pool, owner, Number((await rows<{ id: number }>("SELECT id FROM ranking_providers WHERE slug = 'qs'"))[0].id), form({
      rightsStatus: 'conditional', licenceReference: 'Email from QS, 2 Nov 2026 (synthetic test)', rightsCheckedAt: TODAY, rightsNotes: 'Conditional acceptance pending the formal agreement.', ...attribution, reason: 'Test',
    }))
    for (const bad of [{ position: 45, label: '=46' }, { position: 45, label: 'tied' }, { position: 45, label: '=45!' }, { bandLow: 731, bandHigh: 740, label: '740' }])
      await expect(T.importRecords(pool, editor, `bad-${JSON.stringify(bad)}.json`, file([uni('Bad Label University', 'GB', bad)])), JSON.stringify(bad)).rejects.toMatchObject({ blockers: expect.arrayContaining([expect.stringMatching(/label/i)]) })
  })
})

describe('the public directory view', () => {
  it('returns nothing while QS is only conditional, however many ranks are stored', async () => {
    const pool = getAdminPool()
    const gb = Array.from({ length: 55 }, (_, i) => uni(`Gb University ${String(i + 1).padStart(2, '0')}`, 'GB', { position: i + 1 }))
    const us = [
      uni('Us Alpha', 'US', { position: 1 }),
      uni('Us Bravo', 'US', { position: 2, label: '=2' }),
      uni('Us Charlie', 'US', { position: 2, label: '=2' }),
      uni('Us Delta', 'US', { bandLow: 731, bandHigh: 740, label: '731-740' }),
      uni('Us Echo', 'US', { position: 1401, label: '1401+' }),
    ]
    const summary = await T.importRecords(pool, editor, 'qs-gb.json', file(gb))
    expect(summary).toMatchObject({ universitiesCreated: 55, rankingsCreated: 55 })
    await T.importRecords(pool, editor, 'qs-us.json', file(us))
    expect(await rows('SELECT id FROM public_qs_directory')).toHaveLength(0)
    expect(await fetchQsPage(pool, 'GB', '', 0)).toEqual({ cards: [], total: 0, published: false })
  })

  it('shows at most 50 per destination in global order once QS is recorded as licensed, with ties and bands exactly', async () => {
    const pool = getAdminPool()
    const [qs] = await rows<{ id: number }>("SELECT id FROM ranking_providers WHERE slug = 'qs'")
    // The owner records the executed licence; ordering must be covered for the directory to use it.
    await W.updateRankingRights(pool, owner, qs.id, form({ rightsStatus: 'licensed', licenceReference: 'SYNTHETIC-TEST', licenceScope: 'Synthetic test scope', rightsCheckedAt: TODAY, allowOrdering: 'on', ...attribution, reason: 'Test' }))

    const gb = await fetchQsPage(pool, 'GB', '', 0)
    expect(gb.total).toBe(50) // 55 stored, never more than 50 shown
    expect(gb.published).toBe(true)
    expect(gb.cards.map((c) => c.rank).slice(0, 3)).toEqual(['#1', '#2', '#3'])
    const all: string[] = []
    for (let offset = 0; offset < 100; offset += 25) all.push(...(await fetchQsPage(pool, 'GB', '', offset)).cards.map((c) => c.name))
    expect(all).toHaveLength(50) // pagination reaches the real end
    expect(all[0]).toBe('Gb University 01')
    expect(all.at(-1)).toBe('Gb University 50')
    expect(new Set(all).size).toBe(50)
    expect((await fetchQsPage(pool, 'GB', '', 50)).cards).toEqual([])

    const us = await fetchQsPage(pool, 'US', '', 0)
    expect(us.cards.map((c) => c.rank)).toEqual(['#1', '=2', '=2', '731-740', '1401+'])
    expect(us.cards.map((c) => c.name)).toEqual(['Us Alpha', 'Us Bravo', 'Us Charlie', 'Us Delta', 'Us Echo'])
    // Cards carry exactly three things.
    expect(Object.keys(us.cards[0]).sort()).toEqual(['name', 'rank', 'verified'])
    // Search by name, within the destination only.
    expect((await fetchQsPage(pool, 'US', 'brav', 0)).cards.map((c) => c.name)).toEqual(['Us Bravo'])
    expect((await fetchQsPage(pool, 'GB', 'Us Bravo', 0)).cards).toEqual([])
    expect((await fetchQsPage(pool, 'US', '50%_', 0)).total).toBe(0) // LIKE wildcards are escaped
    // A destination with nothing says so with zero cards, not an error.
    expect(await fetchQsPage(pool, 'FI', '', 0)).toMatchObject({ cards: [], total: 0, published: true })
  })

  it('marks a university Verified only after LockIn itself verified and published it', async () => {
    const pool = getAdminPool()
    const [alpha] = await rows<{ id: number }>("SELECT id FROM universities WHERE slug = 'us-alpha'")
    expect((await fetchQsPage(pool, 'US', 'Alpha', 0)).cards[0].verified).toBe(false)
    await W.transitionRecord(pool, editor, 'university', alpha.id, 'submit_for_review', form({}))
    expect((await fetchQsPage(pool, 'US', 'Alpha', 0)).cards[0].verified).toBe(false) // in review is not verified
    await T.bulkVerify(pool, owner, 'university', [alpha.id], form({ checkedAt: TODAY, reviewDueAt: new Date(Date.parse(`${TODAY}T00:00:00Z`) + 180 * 86_400_000).toISOString().slice(0, 10) }))
    expect((await fetchQsPage(pool, 'US', 'Alpha', 0)).cards[0].verified).toBe(false) // verified but not yet published
    await W.transitionRecord(pool, owner, 'university', alpha.id, 'publish', form({}))
    expect((await fetchQsPage(pool, 'US', 'Alpha', 0)).cards[0].verified).toBe(true)
    expect((await fetchQsPage(pool, 'US', 'Bravo', 0)).cards[0].verified).toBe(false)
  })

  it('goes dark again if the licence is withdrawn or a university is archived', async () => {
    const pool = getAdminPool()
    await db.query("UPDATE universities SET listing_hidden = 1 WHERE slug = 'us-echo'")
    expect((await fetchQsPage(pool, 'US', '', 0)).cards.map((c) => c.name)).not.toContain('Us Echo')
    await db.query("UPDATE universities SET listing_hidden = 0 WHERE slug = 'us-echo'")
    await db.query("UPDATE ranking_providers SET allow_ordering = 0 WHERE slug = 'qs'")
    expect((await fetchQsPage(pool, 'US', '', 0)).published).toBe(false)
    await db.query("UPDATE ranking_providers SET allow_ordering = 1 WHERE slug = 'qs'")
    expect((await fetchQsPage(pool, 'US', '', 0)).published).toBe(true)
  })
})

describe('the QS directory scope', () => {
  it('archives out-of-scope records and dismisses admissions conflicts, only for the Owner, with a full audit trail', async () => {
    const pool = getAdminPool()
    // Two records the directory does not list: one draft with an admissions conflict, one with a website conflict.
    const outA = await W.createRecord(pool, editor, 'university', form({ name: 'Outside One', slug: 'outside-one', destinationIso2: 'DE' }), null)
    const outB = await W.createRecord(pool, editor, 'university', form({ name: 'Outside Two', slug: 'outside-two', destinationIso2: 'DE' }), null)
    await db.query("INSERT INTO data_conflicts (kind, entity_type, entity_id, field_name, current_value, proposed_value, detail) VALUES ('field_value', 'university', ?, 'admissions_url', NULL, 'https://x.example/admissions', 'admissions')", [outA])
    await db.query("INSERT INTO data_conflicts (kind, entity_type, entity_id, field_name, current_value, proposed_value, detail) VALUES ('field_value', 'university', ?, 'official_website', NULL, 'https://x.example/', 'website')", [outB])

    await expect(T.applyQsDirectoryScope(pool, reviewer)).rejects.toThrow(/permission/)
    const result = await T.applyQsDirectoryScope(pool, owner)
    expect(result).toMatchObject({ inScope: 55, archived: 7, dismissed: 1 })
    expect(result.keptPublished).toBe(0)
    expect((await rows<{ listing_hidden: number }>('SELECT listing_hidden FROM universities WHERE id IN (?, ?) ORDER BY id', [outA, outB])).map((r) => Number(r.listing_hidden))).toEqual([1, 1])
    // Gb University 51–55 have ranks too but fall outside the top 50, so they are archived as well.
    expect(Number((await rows<{ n: number }>("SELECT COUNT(*) AS n FROM universities WHERE listing_hidden = 1"))[0].n)).toBe(2 + 5)
    // Nothing is deleted, the website conflict is still open, the admissions one is dismissed with a note.
    expect(Number((await rows<{ n: number }>("SELECT COUNT(*) AS n FROM universities"))[0].n)).toBe(62)
    expect(await rows("SELECT field_name, status FROM data_conflicts WHERE entity_id IN (?, ?) ORDER BY field_name", [outA, outB])).toEqual([
      { field_name: 'admissions_url', status: 'dismissed' },
      { field_name: 'official_website', status: 'open' },
    ])
    expect(await rows("SELECT action FROM data_change_log WHERE entity_type = 'data_conflict' AND action = 'resolve_conflict'")).toHaveLength(1)
    expect(Number((await rows<{ n: number }>("SELECT COUNT(*) AS n FROM data_change_log WHERE action = 'provisional_change' AND reason LIKE 'Outside the QS 2027%'"))[0].n)).toBe(7)
    // The directory is unchanged (it never listed them) and the second run does nothing.
    expect(await T.applyQsDirectoryScope(pool, owner)).toMatchObject({ archived: 0, dismissed: 0 })
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true })
  })

  it('refuses to run before any QS 2027 rank exists, so it can never archive everything', async () => {
    await db.query('DELETE FROM university_rankings')
    await expect(T.applyQsDirectoryScope(getAdminPool(), owner)).rejects.toThrow(/Import the QS 2027 ranks first/)
  })
})
