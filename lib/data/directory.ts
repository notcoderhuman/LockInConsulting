import { todayIso } from './publication'
import type { DirectoryResult } from './types'

/**
 * Loads the public university directory for one destination.
 * No DATABASE_URL (the current state, pending the Hostinger plan) → `not_configured`, and the
 * page shows an honest "pending verification" state. A DB failure → `error`, never fake data.
 *
 * The ONLY source of public listings is the `public_*` views, which enforce verification, source
 * evidence, review dates, publication and ranking/FX rights in the database (D-012, D-013).
 * Research files in db/intake/ are private `pending_admin_entry` evidence and are never read here
 * (D-024, D-026, RISKS.md R-029).
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
