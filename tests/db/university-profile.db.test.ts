// University profile pages read one entry by destination + slug from the public views only.
// Synthetic data. Unknown, hidden, draft or other-destination slugs → null (the page 404s);
// private notes and identity evidence never reach the result.
import type { Connection } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { todayIso } from '@/lib/data/publication'

const { fetchUniversityProfile } = await import('@/lib/db/directory-queries')

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const SECRET = 'PRIVATE-REVIEW-NOTE'
let sourceId = 0

const insert = async (fields: Record<string, unknown>) => {
  await db.query('INSERT INTO universities SET ?', [{ destination_iso2: 'DE', official_website: 'https://uni.example/', verification_notes: SECRET, ...fields }])
}
const profile = (slug: string, iso2 = 'DE') => fetchUniversityProfile(db, iso2, slug, TODAY)

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  const [src] = await db.query("INSERT INTO sources (url, title, publisher, source_type) VALUES ('https://uni.example/', 'Home (synthetic)', 'Synthetic University', 'university_official')")
  sourceId = Number((src as { insertId: number }).insertId)
  const checked = { provisional_listing: 1, identity_checked_at: TODAY, identity_evidence: `${SECRET} evidence`, source_id: sourceId }
  await insert({ name: 'Checked University', slug: 'checked-university', city: 'Synthville', identity_city_confirmed: 1, ...checked })
  await insert({ name: 'Pending University', slug: 'pending-university', city: 'Hiddenville', publication_status: 'in_review' })
  await insert({ name: 'Draft University', slug: 'draft-university' })
  await insert({ name: 'Hidden University', slug: 'hidden-university', listing_hidden: 1, ...checked })
}, 240_000)

afterAll(async () => {
  await db?.end()
  await server?.stop()
})

describe('university profile (public views only)', () => {
  it('returns a website-checked candidate with identity fields only', async () => {
    const entry = await profile('checked-university')
    expect(entry).toMatchObject({ listing: 'provisional', identityStatus: 'checked', officialWebsite: 'https://uni.example/', city: 'Synthville', identityCheckedAt: TODAY })
    expect(Object.keys(entry ?? {})).not.toEqual(expect.arrayContaining(['courses']))
    expect(JSON.stringify(entry)).not.toContain(SECRET)
  })

  it('returns a pending candidate by name only: no website, city or date', async () => {
    expect(await profile('pending-university')).toMatchObject({ identityStatus: 'pending', officialWebsite: null, city: null, identityCheckedAt: null })
  })

  it('returns null for drafts, hidden records, unknown slugs and the wrong destination', async () => {
    for (const slug of ['draft-university', 'hidden-university', 'no-such-university']) expect(await profile(slug)).toBeNull()
    expect(await profile('checked-university', 'US')).toBeNull()
  })
})
