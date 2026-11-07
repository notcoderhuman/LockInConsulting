import { DESTINATIONS } from '@/lib/destinations'
import type { QsPage } from '@/lib/db/qs-directory-queries'

/** The eleven destinations, in the order the directory shows them. */
export const DIRECTORY_DESTINATIONS = DESTINATIONS.map((d) => ({ iso2: d.iso2, name: d.shortName ?? d.name }))

/** The attribution QS requires beside its ranking, exactly as agreed (the link is the QS rankings page). */
export const QS_ATTRIBUTION = {
  text: 'Source: QS Quacquarelli Symonds (www.topuniversities.com). With permission.',
  url: 'https://www.topuniversities.com/world-university-rankings',
} as const

export type QsDirectoryResult = ({ state: 'ready' } & QsPage) | { state: 'not_configured' } | { state: 'error' }

export interface QsRequest {
  iso2: string
  q: string
  offset: number
}

/** Parses ?d=<iso2>&q=<name>&offset=<n>. Anything outside these shapes is refused, never guessed. */
export function parseQsRequest(params: URLSearchParams): QsRequest | null {
  const iso2 = (params.get('d') ?? '').toUpperCase()
  if (!DESTINATIONS.some((d) => d.iso2 === iso2)) return null
  const q = (params.get('q') ?? '').trim().slice(0, 80)
  const offset = Number(params.get('offset') ?? 0)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5000) return null
  return { iso2, q, offset }
}

export async function getQsDirectory({ iso2, q, offset }: QsRequest): Promise<QsDirectoryResult> {
  if (!process.env.DATABASE_URL) return { state: 'not_configured' }
  try {
    const [{ getPool }, { fetchQsPage }] = await Promise.all([import('@/lib/db/pool'), import('@/lib/db/qs-directory-queries')])
    return { state: 'ready', ...(await fetchQsPage(getPool(), iso2, q, offset)) }
  } catch (error) {
    console.error('[qs-directory] failed to load', iso2, error instanceof Error ? error.message : error)
    return { state: 'error' }
  }
}
