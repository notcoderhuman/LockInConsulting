import type { RowDataPacket } from 'mysql2/promise'
import type { ListingSummary } from '@/lib/data/types'
import type { Queryable } from './directory-queries'

// University search, filters and look-ups for saved/recent lists. Reads only the public_* views, so
// every publication rule applies; searches only what those views publish (name and city). Rankings
// are never read here, so they can never become a sort key.

export const SEARCH_PAGE_SIZE = 20
export const LOOKUP_MAX = 50
export const SEARCH_SORTS = ['relevance', 'name', 'name_desc', 'status'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export interface SearchQuery {
  q: string
  destination: string | null
  status: ListingSummary['status'] | null
  category: ListingSummary['category'] | null
  sort: SearchSort
  offset: number
}

// One row per listed entry, verified and provisional alike. A pending entry's city is already NULL in
// public_provisional_universities, so it cannot be searched by city or shown.
const LISTINGS = `(
  SELECT l.destination_iso2, l.slug, l.name,
         CASE WHEN l.listing_state = 'verified' THEN 'verified' ELSE p.identity_status END AS status,
         COALESCE(p.institution_category, 'university') AS category,
         COALESCE(u.city, p.city) AS city
    FROM public_directory_listings l
    LEFT JOIN public_universities u ON l.listing_state = 'verified' AND u.id = l.id
    LEFT JOIN public_provisional_universities p ON l.listing_state = 'provisional' AND p.id = l.id
) s`

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
export const searchTokens = (q: string) => q.trim().split(/\s+/).filter(Boolean).slice(0, 6)

const toSummary = (r: RowDataPacket): ListingSummary => ({
  destinationIso2: String(r.destination_iso2),
  slug: String(r.slug),
  name: String(r.name),
  status: r.status === 'verified' || r.status === 'checked' ? r.status : 'pending',
  category: r.category === 'other' ? 'other' : 'university',
  city: r.city == null ? null : String(r.city),
})

export async function searchListings(db: Queryable, query: SearchQuery): Promise<{ results: ListingSummary[]; total: number }> {
  const where: string[] = []
  const params: unknown[] = []
  // Every word must appear in the name or the city ("tech munich" finds Technical University of Munich).
  for (const token of searchTokens(query.q)) {
    where.push('(s.name LIKE ? OR s.city LIKE ?)')
    params.push(`%${escapeLike(token)}%`, `%${escapeLike(token)}%`)
  }
  if (query.destination) where.push('s.destination_iso2 = ?'), params.push(query.destination)
  if (query.status) where.push('s.status = ?'), params.push(query.status)
  if (query.category) where.push('s.category = ?'), params.push(query.category)
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const q = query.q.trim()
  const sort = query.sort === 'relevance' && !q ? 'name' : query.sort
  // Best match: the whole phrase starting the name, then starting a word in it, then anywhere; ties by name.
  const relevance = 'CASE WHEN s.name LIKE ? THEN 0 WHEN s.name LIKE ? THEN 1 WHEN s.name LIKE ? THEN 2 ELSE 3 END'
  const order = {
    relevance: `${relevance}, s.name`,
    name: 's.name',
    name_desc: 's.name DESC',
    status: "FIELD(s.status, 'verified', 'checked', 'pending'), s.name",
  }[sort]
  const orderParams = sort === 'relevance' ? [`${escapeLike(q)}%`, `% ${escapeLike(q)}%`, `%${escapeLike(q)}%`] : []

  const [[count]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${LISTINGS} ${filter}`, params)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT s.* FROM ${LISTINGS} ${filter} ORDER BY ${order}, s.destination_iso2, s.slug LIMIT ? OFFSET ?`,
    [...params, ...orderParams, SEARCH_PAGE_SIZE, query.offset],
  )
  return { results: rows.map(toSummary), total: Number(count.n) }
}

/** The current public state of saved/recent entries. A key not in the result is no longer listed. */
export async function lookupListings(db: Queryable, keys: { destinationIso2: string; slug: string }[]): Promise<ListingSummary[]> {
  if (!keys.length) return []
  const [rows] = await db.query<RowDataPacket[]>(`SELECT s.* FROM ${LISTINGS} WHERE (s.destination_iso2, s.slug) IN (?)`, [
    keys.slice(0, LOOKUP_MAX).map((k) => [k.destinationIso2, k.slug]),
  ])
  return rows.map(toSummary)
}
