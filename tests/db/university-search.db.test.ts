// University search and saved/recent look-ups against a real database. Synthetic data.
// Only public_* views are read: drafts and hidden records are never found, a pending candidate's city
// is never searchable, and results carry identity fields and status only.
import type { Connection } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { todayIso } from '@/lib/data/publication'

const { searchListings, lookupListings } = await import('@/lib/db/search-queries')
type SearchQuery = import('@/lib/db/search-queries').SearchQuery

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const SECRET = 'PRIVATE-REVIEW-NOTE'

const search = (q: Partial<SearchQuery>) => searchListings(db, { q: '', destination: null, status: null, category: null, sort: 'name', offset: 0, ...q })
const names = async (q: Partial<SearchQuery>) => (await search(q)).results.map((r) => r.name)

beforeAll(async () => {
  server = await startTestDatabase()
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  const [src] = await db.query("INSERT INTO sources (url, title, publisher, source_type) VALUES ('https://uni.example/', 'Home (synthetic)', 'Synthetic', 'university_official')")
  const sourceId = Number((src as { insertId: number }).insertId)
  const insert = (fields: Record<string, unknown>) =>
    db.query('INSERT INTO universities SET ?', [{ destination_iso2: 'DE', official_website: 'https://uni.example/', verification_notes: SECRET, ...fields }])
  const checked = (city: string) => ({ provisional_listing: 1, identity_checked_at: TODAY, identity_evidence: 'evidence', source_id: sourceId, city, identity_city_confirmed: 1 })
  await insert({ name: 'Freie Universität Berlin', slug: 'freie-universitat-berlin', ...checked('Berlin') })
  await insert({ name: 'Technical University of Munich', slug: 'technical-university-of-munich', ...checked('Munich') })
  await insert({ name: 'Berlin School of 100% Design_Arts', slug: 'berlin-design', ...checked('Berlin') })
  await insert({ name: 'Applied Polytechnic', slug: 'applied-polytechnic', institution_category: 'other', ...checked('Hamburg') })
  await insert({ name: 'Pending Institute', slug: 'pending-institute', city: 'Secretville', publication_status: 'in_review' })
  await insert({ name: 'Draft Berlin University', slug: 'draft-berlin', city: 'Berlin' })
  await insert({ name: 'Hidden Berlin University', slug: 'hidden-berlin', listing_hidden: 1, ...checked('Berlin') })
  await insert({ name: 'Boston Technical College', slug: 'boston-technical', destination_iso2: 'US', ...checked('Boston') })
}, 240_000)

afterAll(async () => {
  await db?.end()
  await server?.stop()
})

describe('university search (public views only)', () => {
  it('finds by name or city, every word required, ignoring case and accents', async () => {
    expect(await names({ q: 'berlin' })).toEqual(['Berlin School of 100% Design_Arts', 'Freie Universität Berlin'])
    expect(await names({ q: 'UNIVERSITAT' })).toEqual(['Freie Universität Berlin'])
    expect(await names({ q: 'technical munich' })).toEqual(['Technical University of Munich'])
    expect(await names({ q: 'munich harvard' })).toEqual([])
  })

  it('never finds drafts, hidden records, or a pending candidate by its unpublished city', async () => {
    const all = await names({})
    expect(all).not.toContain('Draft Berlin University')
    expect(all).not.toContain('Hidden Berlin University')
    expect(await names({ q: 'secretville' })).toEqual([])
    expect(await names({ q: 'pending' })).toEqual(['Pending Institute'])
  })

  it('treats % and _ as text, not wildcards', async () => {
    expect(await names({ q: '100%' })).toEqual(['Berlin School of 100% Design_Arts'])
    expect(await names({ q: '_' })).toEqual(['Berlin School of 100% Design_Arts'])
    expect(await names({ q: '%' })).toEqual(['Berlin School of 100% Design_Arts'])
  })

  it('filters by destination, status and institution type', async () => {
    expect(await names({ destination: 'US' })).toEqual(['Boston Technical College'])
    expect(await names({ status: 'pending' })).toEqual(['Pending Institute'])
    expect((await search({ status: 'checked' })).total).toBe(5)
    expect(await names({ category: 'other' })).toEqual(['Applied Polytechnic'])
    expect(await names({ status: 'verified' })).toEqual([])
  })

  it('sorts by best match, name either way, or verification status', async () => {
    expect((await names({ q: 'tech', sort: 'relevance' }))[0]).toBe('Technical University of Munich')
    expect(await names({ q: 'tech', sort: 'relevance' })).toEqual(['Technical University of Munich', 'Boston Technical College', 'Applied Polytechnic'])
    expect(await names({ q: 'tech', sort: 'name_desc' })).toEqual(['Technical University of Munich', 'Boston Technical College', 'Applied Polytechnic'])
    expect(await names({ q: 'tech', sort: 'name' })).toEqual(['Applied Polytechnic', 'Boston Technical College', 'Technical University of Munich'])
    expect((await names({ sort: 'status' })).at(-1)).toBe('Pending Institute')
  })

  it('returns identity fields only; a pending entry has no city', async () => {
    const { results, total } = await search({})
    expect(total).toBe(6)
    for (const r of results) expect(Object.keys(r).sort()).toEqual(['category', 'city', 'destinationIso2', 'name', 'slug', 'status'])
    expect(results.find((r) => r.slug === 'pending-institute')).toMatchObject({ status: 'pending', city: null })
    expect(JSON.stringify(results)).not.toContain(SECRET)
  })
})

describe('saved/recent look-up', () => {
  it('returns the current state of listed keys and leaves out anything no longer listed', async () => {
    const found = await lookupListings(db, [
      { destinationIso2: 'DE', slug: 'freie-universitat-berlin' },
      { destinationIso2: 'DE', slug: 'hidden-berlin' },
      { destinationIso2: 'DE', slug: 'draft-berlin' },
      { destinationIso2: 'US', slug: 'freie-universitat-berlin' },
      { destinationIso2: 'DE', slug: 'deleted-long-ago' },
    ])
    expect(found).toEqual([{ destinationIso2: 'DE', slug: 'freie-universitat-berlin', name: 'Freie Universität Berlin', status: 'checked', category: 'university', city: 'Berlin' }])
    expect(await lookupListings(db, [])).toEqual([])
  })
})
