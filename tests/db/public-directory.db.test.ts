// R-029 database regression: even if someone bypasses the admin workflow and writes rows
// directly, the public read path (public_* views → fetchDestinationDirectory) shows a university
// only when it is verified, sourced, published and inside its review window, and a ranking only
// when its provider's reuse rights are licensed (and unexpired) or not required.
// Research-shaped records (a synthetic stand-in for the private research) are entered here as
// ordinary drafts to prove they stay hidden.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { todayIso } from '@/lib/data/publication'

const { fetchDestinationDirectory, fetchDirectoryPage } = await import('@/lib/db/directory-queries')
const { loadEvidence } = await import('@/lib/derek/evidence')

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const addDays = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
// The real research is kept outside this repository; a synthetic file of the same shape stands in.
const research = JSON.parse(readFileSync(path.join(__dirname, '..', 'fixtures', 'pending-research.json'), 'utf8')) as {
  status: string
  records: { officialName: string; slug: string; identity: { url: string } }[]
}

let sourceId = 0
let qsId = 0

async function insertUniversity(fields: Record<string, unknown>): Promise<number> {
  const [res] = await db.query('INSERT INTO universities SET ?', [{ destination_iso2: 'DE', official_website: 'https://uni.example/', ...fields }])
  return Number((res as { insertId: number }).insertId)
}
const verifiedPublished = () => ({
  publication_status: 'published',
  verification_status: 'verified',
  source_id: sourceId,
  checked_at: TODAY,
  verified_at: `${TODAY} 00:00:00`,
  verified_by: 'u-reviewer',
  review_due_at: addDays(90),
})
const publicNames = async () => (await fetchDestinationDirectory(db, 'DE', TODAY)).map((u) => u.name)

beforeAll(async () => {
  server = await startTestDatabase()
  console.info(`[db] public-directory suite running on ${server.engine}`)
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  const [src] = await db.query("INSERT INTO sources (url, title, publisher, source_type) VALUES ('https://uni.example/official', 'Official page (synthetic)', 'Example University (synthetic)', 'university_official')")
  sourceId = Number((src as { insertId: number }).insertId)
  const [[qs]] = await db.query<RowDataPacket[]>("SELECT id, rights_status FROM ranking_providers WHERE slug = 'qs'")
  expect(qs.rights_status).toBe('not_confirmed')
  qsId = Number(qs.id)
}, 240_000)

afterAll(async () => {
  await db?.end()
  await server?.stop()
})

describe('public directory output (R-029)', () => {
  it('keeps research records entered as drafts out of the public directory', async () => {
    expect(research.status).toBe('pending_admin_entry')
    for (const r of research.records.slice(0, 3)) await insertUniversity({ name: r.officialName, slug: r.slug, official_website: r.identity.url })
    expect(await publicNames()).toEqual([])
    const [[n]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM public_universities')
    expect(Number(n.n)).toBe(0)
  })

  it('refuses a "published" record that was never verified, even written directly', async () => {
    await expect(insertUniversity({ name: 'Bypass University', slug: 'bypass-university', publication_status: 'published' })).rejects.toThrow(/constraint/i)
    await expect(insertUniversity({ name: 'No Evidence University', slug: 'no-evidence-university', ...verifiedPublished(), source_id: null })).rejects.toThrow(/constraint/i)
  })

  it('hides a published record whose review date has passed', async () => {
    await insertUniversity({ name: 'Expired Review University', slug: 'expired-review-university', ...verifiedPublished(), checked_at: addDays(-200), review_due_at: addDays(-1) })
    expect(await publicNames()).not.toContain('Expired Review University')
  })

  it('shows a verified QS ranking only once reuse rights are licensed and unexpired', async () => {
    const uni = await insertUniversity({ name: 'Ranked Test University', slug: 'ranked-test-university', ...verifiedPublished() })
    await db.query('INSERT INTO university_rankings SET ?', [{ university_id: uni, provider_id: qsId, ranking_year: 2025, rank_position: 7, ...verifiedPublished() }])
    const rankings = async () => (await fetchDestinationDirectory(db, 'DE', TODAY)).find((u) => u.id === uni)!.rankings

    // The university itself is legitimately public; its QS position is not.
    expect(await publicNames()).toEqual(['Ranked Test University'])
    expect(await rankings()).toEqual([])

    await db.query("UPDATE ranking_providers SET rights_status = 'requested' WHERE id = ?", [qsId])
    expect(await rankings()).toEqual([])
    await db.query(
      "UPDATE ranking_providers SET rights_status = 'licensed', licence_reference = 'TEST-1', licence_scope = 'Synthetic test licence', rights_checked_at = ?, licence_expires_at = ? WHERE id = ?",
      [addDays(-30), addDays(-1), qsId],
    )
    expect(await rankings()).toEqual([]) // licence expired
    await db.query('UPDATE ranking_providers SET licence_expires_at = ? WHERE id = ?', [addDays(30), qsId])
    expect(await rankings()).toEqual([]) // licensed, but no attribution wording and link recorded yet
    await db.query("UPDATE ranking_providers SET attribution_text = 'Source: synthetic', attribution_url = 'https://www.topuniversities.com/world-university-rankings' WHERE id = ?", [qsId])
    expect((await rankings()).map((r) => r.position)).toEqual([7]) // the gate, not the code, decides

    await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed', licence_reference = NULL, licence_scope = NULL, licence_expires_at = NULL, attribution_text = NULL, attribution_url = NULL WHERE id = ?", [qsId])
    expect(await rankings()).toEqual([])
  })
})

describe('public directory paging (5 per page, at most 50)', () => {
  const page = (iso2: string, offset: number) => fetchDirectoryPage(db, iso2, TODAY, offset)
  const addMany = async (iso2: string, names: string[]) => {
    for (const name of names) await insertUniversity({ destination_iso2: iso2, name, slug: `${iso2}-${name}`.toLowerCase().replace(/\W+/g, '-'), ...verifiedPublished() })
  }

  it('pages 12 listings as 5, 5, 2 in a stable order, with no overlap and drafts excluded', async () => {
    await addMany('IT', Array.from({ length: 12 }, (_, i) => `Italia ${String.fromCharCode(76 - i)}`)) // inserted Z→A-ish to prove ordering
    await insertUniversity({ destination_iso2: 'IT', name: 'Italia Draft', slug: 'it-draft' })
    const pages = [await page('IT', 0), await page('IT', 5), await page('IT', 10), await page('IT', 15)]
    expect(pages.map((p) => p.total)).toEqual([12, 12, 12, 12])
    expect(pages.map((p) => p.entries.length)).toEqual([5, 5, 2, 0])
    const names = pages.flatMap((p) => p.entries.map((u) => u.name))
    expect(new Set(names).size).toBe(12)
    expect(names).toEqual([...names].sort())
    expect(names).not.toContain('Italia Draft')
    expect(await page('IT', 0)).toEqual(pages[0]) // the same request gives the same page
  })

  it('orders by the published QS rank or band once rights are licensed, and by name while they are not', async () => {
    const names = async () => (await page('FI', 0)).entries.map((u) => u.name)
    await addMany('FI', ['Aalto Test', 'Banded Test', 'Ranked Test'])
    const [ids] = await db.query<RowDataPacket[]>("SELECT id, name FROM universities WHERE destination_iso2 = 'FI'")
    const id = (n: string) => Number(ids.find((r) => r.name === n)!.id)
    await db.query('INSERT INTO university_rankings SET ?', [{ university_id: id('Ranked Test'), provider_id: qsId, ranking_year: 2026, rank_position: 120, ...verifiedPublished() }])
    await db.query('INSERT INTO university_rankings SET ?', [{ university_id: id('Banded Test'), provider_id: qsId, ranking_year: 2026, rank_band_low: 501, rank_band_high: 510, ...verifiedPublished() }])
    expect(await names()).toEqual(['Aalto Test', 'Banded Test', 'Ranked Test']) // QS not licensed: name order
    await db.query(
      "UPDATE ranking_providers SET rights_status = 'licensed', licence_reference = 'TEST-2', licence_scope = 'Synthetic test licence', rights_checked_at = ?, licence_expires_at = ?, attribution_text = 'Source: synthetic attribution', attribution_url = 'https://www.topuniversities.com/world-university-rankings' WHERE id = ?",
      [TODAY, addDays(30), qsId],
    )
    try {
      // Licensed for display only: ranks are shown (with the attribution) but do not order the list.
      expect(await names()).toEqual(['Aalto Test', 'Banded Test', 'Ranked Test'])
      const ranked = (await page('FI', 0)).entries.find((u) => u.name === 'Ranked Test')!
      if (ranked.listing !== 'verified') throw new Error('expected a verified entry')
      expect(ranked.rankings).toMatchObject([{ position: 120, attribution: 'Source: synthetic attribution', aiUseAllowed: false }])
      await db.query('UPDATE ranking_providers SET allow_ordering = 1 WHERE id = ?', [qsId])
      expect(await names()).toEqual(['Ranked Test', 'Banded Test', 'Aalto Test']) // rank, band, then unranked

      // Derek quotes the rank to the AI provider only when the licence allows that use.
      const rankingEvidence = async () => (await loadEvidence(db, 'Is Ranked Test good?', TODAY)).filter((e) => e.ref.startsWith('university_ranking:'))
      expect(await rankingEvidence()).toEqual([])
      await db.query('UPDATE ranking_providers SET allow_ai_use = 1 WHERE id = ?', [qsId])
      expect((await rankingEvidence()).map((e) => e.text)).toEqual(['Ranked Test ranking: QS Quacquarelli Symonds 2026: #120'])
    } finally {
      await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed', licence_reference = NULL, licence_scope = NULL, licence_expires_at = NULL, attribution_text = NULL, attribution_url = NULL, allow_ordering = 0, allow_ai_use = 0 WHERE id = ?", [qsId])
    }
    expect(await names()).toEqual(['Aalto Test', 'Banded Test', 'Ranked Test']) // licence withdrawn: back to name order
  })

  it('caps a destination at 50 listings', async () => {
    await addMany('PL', Array.from({ length: 53 }, (_, i) => `Polska ${String(i).padStart(2, '0')}`))
    expect((await page('PL', 0)).total).toBe(50)
    const last = await page('PL', 45)
    expect(last.entries.map((u) => u.name)).toEqual(['Polska 45', 'Polska 46', 'Polska 47', 'Polska 48', 'Polska 49'])
    expect((await page('PL', 50)).entries).toEqual([])
  })

  it('returns an empty page, not an error, for a destination with nothing published', async () => {
    expect(await page('NZ', 0)).toEqual({ entries: [], total: 0, verifiedTotal: 0, otherTotal: 0 })
  })
})
