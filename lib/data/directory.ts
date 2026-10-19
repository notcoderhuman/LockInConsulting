import { todayIso } from './publication'
import type { DirectoryResult } from './types'
import { getVerifiedUniversities } from './verified-directory'

/**
 * Loads the public university directory for one destination.
 * If DATABASE_URL is configured, fetches from the live database.
 * If DATABASE_URL is not configured (development/preview), returns verified research directory data.
 */
export async function getDestinationDirectory(iso2: string): Promise<DirectoryResult> {
  if (process.env.DATABASE_URL) {
    try {
      const [{ getPool }, { fetchDestinationDirectory }] = await Promise.all([
        import('@/lib/db/pool'),
        import('@/lib/db/directory-queries'),
      ])
      const universities = await fetchDestinationDirectory(getPool(), iso2, todayIso())
      return { state: 'ready', universities }
    } catch (error) {
      console.error('[directory] failed to load destination', iso2, error instanceof Error ? error.message : error)
      return { state: 'error' }
    }
  }

  const universities = getVerifiedUniversities(iso2)
  if (universities.length > 0) {
    return { state: 'ready', universities }
  }

  return { state: 'not_configured' }
}
