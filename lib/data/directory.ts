import { todayIso } from './publication'
import type { DirectoryResult } from './types'

/**
 * Loads the public university directory for one destination.
 * No DATABASE_URL (the current state, pending the Hostinger plan) → `not_configured`, and the
 * page shows an honest "pending verification" state. A DB failure → `error`, never fake data.
 */
export async function getDestinationDirectory(iso2: string): Promise<DirectoryResult> {
  if (!process.env.DATABASE_URL) return { state: 'not_configured' }
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
