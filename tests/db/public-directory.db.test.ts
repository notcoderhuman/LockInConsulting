// R-029 database regression: even if someone bypasses the admin workflow and writes rows
// directly, the public read path (public_* views → fetchDestinationDirectory) shows a university
// only when it is verified, sourced, published and inside its review window, and a ranking only
// when its provider's reuse rights are licensed (and unexpired) or not required.
// Research records from db/intake/ are entered here as ordinary drafts to prove they stay hidden.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { todayIso } from '@/lib/data/publication'

const { fetchDestinationDirectory } = await import('@/lib/db/directory-queries')

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const addDays = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const research = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'db', 'intake', 'destinations', 'germany.json'), 'utf8')) as {
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
    expect((await rankings()).map((r) => r.position)).toEqual([7]) // the gate, not the code, decides

    await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed', licence_reference = NULL, licence_scope = NULL, licence_expires_at = NULL WHERE id = ?", [qsId])
    expect(await rankings()).toEqual([])
  })
})
