// Migration 0015 and the unranked entries of the public QS directory, against a real database (synthetic data).
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
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const qsSource = (n: string) => ({ url: `https://www.topuniversities.com/universities/${n}`, title: `${n}: QS`, publisher: 'QS Quacquarelli Symonds', sourceType: 'ranking_provider' })
const uni = (name: string, iso2: string, ranking?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  destinationIso2: iso2,
  name,
  slug: slug(name),
  officialWebsite: `https://www.${slug(name)}.example/`,
  source: { url: `https://official.example/${slug(name)}`, title: name, publisher: 'Example (synthetic)', sourceType: 'university_official' },
  ...(ranking ? { rankings: [{ provider: 'qs', year: 2027, edition: 'QS 2027', source: qsSource(slug(name)), ...ranking }] } : {}),
  ...extra,
})
const file = (universities: unknown[]) => JSON.stringify({ format: 'lockin-import@1', universities })
const attribution = { attributionText: 'Source: QS Quacquarelli Symonds (www.topuniversities.com). With permission.', attributionUrl: 'https://www.topuniversities.com/world-university-rankings' }
const DESTS = ['CA', 'IT', 'PL', 'AU', 'SA', 'AE', 'FI', 'NZ']

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

describe('unranked universities in the QS directory', () => {
  it('lists them after the ranked ones, without a rank, only for the eligible destinations, only when licensed', async () => {
    const pool = getAdminPool()
    const [qs] = await rows<{ id: number }>("SELECT id FROM ranking_providers WHERE slug = 'qs'")
    await W.updateRankingRights(pool, owner, qs.id, form({ rightsStatus: 'conditional', licenceReference: 'Synthetic test', rightsCheckedAt: TODAY, rightsNotes: 'test', ...attribution, reason: 'Test' }))
    // Every eligible destination has one ranked university; Poland and Canada also have unranked ones, Germany too (not eligible).
    const ranked = [...DESTS, 'US', 'GB', 'DE'].map((d) => uni(`${d} Ranked`, d, { position: 10 }))
    const unranked = [
      uni('Zeta Unranked', 'PL'), uni('Alpha Unranked', 'PL'), uni('Mid Unranked', 'PL'),
      uni('Unranked In Canada', 'CA'),
      uni('Branch Campus', 'PL'),
      uni('Germany Unranked', 'DE'),
    ]
    await T.importRecords(pool, editor, 'ranked.json', file(ranked))
    await T.importRecords(pool, editor, 'unranked.json', file(unranked))
    // A hidden (archived) record, as the scope action leaves out-of-scope ones.
    await db.query("UPDATE universities SET listing_hidden = 1 WHERE slug IN ('zeta-unranked', 'germany-unranked')")
    await db.query("UPDATE universities SET institution_category = 'other' WHERE slug = 'branch-campus'")

    await expect(T.listUnrankedUniversities(pool, editor)).rejects.toThrow(/permission/)
    // Missing ranks for a destination stop it.
    await db.query('UPDATE university_rankings SET ranking_year = 2026 WHERE university_id = (SELECT id FROM universities WHERE slug = ?)', ['fi-ranked'])
    await expect(T.listUnrankedUniversities(pool, owner)).rejects.toThrow(/Import the QS 2027 ranks for FI/)
    await db.query('UPDATE university_rankings SET ranking_year = 2027 WHERE university_id = (SELECT id FROM universities WHERE slug = ?)', ['fi-ranked'])

    const result = await T.listUnrankedUniversities(pool, owner)
    expect(result.listed).toMatchObject({ PL: 3, CA: 1, IT: 0, FI: 0 }) // Zeta was hidden before; the action un-archives it as an eligible record
    // Not eligible: Germany (not an eligible destination), the non-university record.
    expect(await rows("SELECT directory_unranked FROM universities WHERE slug IN ('germany-unranked', 'branch-campus')")).toEqual([{ directory_unranked: 0 }, { directory_unranked: 0 }])

    // While QS is only conditional the directory is dark, unranked entries included.
    expect(await rows('SELECT id FROM public_qs_directory')).toHaveLength(0)
    await W.updateRankingRights(pool, owner, qs.id, form({ rightsStatus: 'licensed', licenceReference: 'SYNTHETIC', licenceScope: 'test', rightsCheckedAt: TODAY, allowOrdering: 'on', ...attribution, reason: 'Test' }))

    const pl = await fetchQsPage(pool, 'PL', '', 0)
    expect(pl.cards).toEqual([
      { name: 'PL Ranked', rank: '#10', verified: false },
      { name: 'Alpha Unranked', rank: '', verified: false },
      { name: 'Mid Unranked', rank: '', verified: false },
      { name: 'Zeta Unranked', rank: '', verified: false },
    ])
    expect(pl.total).toBe(4)
    expect((await fetchQsPage(pool, 'CA', '', 0)).cards.map((c) => c.name)).toEqual(['CA Ranked', 'Unranked In Canada'])
    expect((await fetchQsPage(pool, 'DE', '', 0)).cards.map((c) => c.name)).toEqual(['DE Ranked']) // Germany Unranked is not eligible
    expect((await fetchQsPage(pool, 'PL', 'unranked', 0)).cards.map((c) => c.name)).toEqual(['Alpha Unranked', 'Mid Unranked', 'Zeta Unranked'])
    // A ranked university never also appears as unranked, even if someone flags it.
    await db.query("UPDATE universities SET directory_unranked = 1 WHERE slug = 'pl-ranked'")
    expect((await fetchQsPage(pool, 'PL', 'PL Ranked', 0)).cards).toEqual([{ name: 'PL Ranked', rank: '#10', verified: false }])
    // Running it again lists nothing new; the scope action keeps the flagged ones and archives nothing of them.
    expect((await T.listUnrankedUniversities(pool, owner)).listed).toMatchObject({ PL: 0, CA: 0 })
    const scope = await T.applyQsDirectoryScope(pool, owner)
    expect(Number((await rows<{ n: number }>("SELECT COUNT(*) AS n FROM universities WHERE slug IN ('alpha-unranked', 'mid-unranked', 'zeta-unranked', 'unranked-in-canada') AND listing_hidden = 1"))[0].n)).toBe(0)
    expect(scope.archived).toBeGreaterThanOrEqual(1) // the non-university record (Germany Unranked was already archived)
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true })
  })

  it('caps a destination at 50 in all', async () => {
    const pool = getAdminPool()
    const many = Array.from({ length: 60 }, (_, i) => uni(`Many ${String(i).padStart(2, '0')}`, 'NZ'))
    await T.importRecords(pool, editor, 'many.json', file(many))
    await T.listUnrankedUniversities(pool, owner)
    const all: string[] = []
    for (let o = 0; o < 100; o += 25) all.push(...(await fetchQsPage(pool, 'NZ', '', o)).cards.map((c) => c.name))
    expect(all).toHaveLength(50)
    expect(all[0]).toBe('NZ Ranked')
    expect(all[1]).toBe('Many 00')
    expect(all.at(-1)).toBe('Many 48')
  })
})
