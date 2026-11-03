import { z } from 'zod'
import { DESTINATIONS } from '@/lib/destinations'
import { LOOKUP_MAX, SEARCH_PAGE_SIZE, SEARCH_SORTS, type SearchQuery } from '@/lib/db/search-queries'
import type { ListingSummary } from './types'

// Request parsing for /api/universities/*: anything outside these shapes is refused, never guessed.
const ISO2 = DESTINATIONS.map((d) => d.iso2) as [string, ...string[]]
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' || v == null ? null : v), schema.nullable())

const searchSchema = z.object({
  q: z.string().max(80).default(''),
  destination: optional(z.enum(ISO2)),
  status: optional(z.enum(['verified', 'checked', 'pending'])),
  category: optional(z.enum(['university', 'other'])),
  sort: z.enum(SEARCH_SORTS).default('relevance'),
  offset: z.coerce.number().int().min(0).max(1000).multipleOf(SEARCH_PAGE_SIZE).default(0),
})

export function parseSearch(params: URLSearchParams): SearchQuery | null {
  const raw = Object.fromEntries(['q', 'destination', 'status', 'category', 'sort', 'offset'].flatMap((k) => (params.has(k) ? [[k, params.get(k)]] : [])))
  const parsed = searchSchema.safeParse(raw)
  return parsed.success ? (parsed.data as SearchQuery) : null
}

/** `u=US:slug` keys for the lookup endpoint; malformed or too many → null. */
export function parseLookupKeys(params: URLSearchParams): { destinationIso2: string; slug: string }[] | null {
  const raw = params.getAll('u')
  if (raw.length > LOOKUP_MAX) return null
  const keys = raw.map((k) => {
    const [iso2, slug, extra] = k.split(':')
    return extra === undefined && ISO2.includes(iso2) && slug && slug.length <= 200 && SLUG.test(slug) ? { destinationIso2: iso2, slug } : null
  })
  return keys.every((k) => k !== null) ? (keys as { destinationIso2: string; slug: string }[]) : null
}

type Loaded<T> = { state: 'ready'; data: T } | { state: 'not_configured' } | { state: 'error' }

async function withPool<T>(label: string, run: (db: import('@/lib/db/directory-queries').Queryable) => Promise<T>): Promise<Loaded<T>> {
  if (!process.env.DATABASE_URL) return { state: 'not_configured' }
  try {
    const { getPool } = await import('@/lib/db/pool')
    return { state: 'ready', data: await run(getPool()) }
  } catch (error) {
    console.error(`[search] ${label} failed`, error instanceof Error ? error.message : error)
    return { state: 'error' }
  }
}

export const searchUniversities = (query: SearchQuery) =>
  withPool('search', async (db) => (await import('@/lib/db/search-queries')).searchListings(db, query))

export const lookupUniversities = (keys: { destinationIso2: string; slug: string }[]): Promise<Loaded<ListingSummary[]>> =>
  withPool('lookup', async (db) => (await import('@/lib/db/search-queries')).lookupListings(db, keys))
