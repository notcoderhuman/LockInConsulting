import { todayIso } from './publication'
import type { DirectoryEntry, DirectoryResult } from './types'

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** One university's profile, from the same public views as the directory. Unknown or malformed slug → null. */
export async function getUniversityProfile(
  iso2: string,
  slug: string,
): Promise<{ state: 'ready'; entry: DirectoryEntry | null } | { state: 'not_configured' } | { state: 'error' }> {
  if (!process.env.DATABASE_URL) return { state: 'not_configured' }
  if (slug.length > 200 || !SLUG.test(slug)) return { state: 'ready', entry: null }
  try {
    const [{ getPool }, { fetchUniversityProfile }] = await Promise.all([import('@/lib/db/pool'), import('@/lib/db/directory-queries')])
    return { state: 'ready', entry: await fetchUniversityProfile(getPool(), iso2, slug, todayIso()) }
  } catch (error) {
    console.error('[directory] failed to load university', iso2, slug, error instanceof Error ? error.message : error)
    return { state: 'error' }
  }
}

/**
 * Loads one page (5 entries, up to 50 in all) of the public university directory for one destination:
 * verified listings and provisional, identity-only entries (D-043).
 * No DATABASE_URL (the current state, pending the Hostinger plan) → `not_configured`, and the
 * page shows an honest "pending verification" state. A DB failure → `error`, never fake data.
 *
 * The ONLY source of public listings is the `public_*` views, which enforce verification, source
 * evidence, review dates, publication and ranking/FX rights in the database (D-012, D-013).
 * Research files in db/intake/ are private `pending_admin_entry` evidence and are never read here
 * (D-024, D-026, RISKS.md R-029).
 */
export async function getDestinationDirectory(iso2: string, offset = 0): Promise<DirectoryResult> {
  if (!process.env.DATABASE_URL) return { state: 'not_configured' }
  try {
    const [{ getPool }, { fetchDirectoryPage }] = await Promise.all([
      import('@/lib/db/pool'),
      import('@/lib/db/directory-queries'),
    ])
    return { state: 'ready', ...(await fetchDirectoryPage(getPool(), iso2, todayIso(), offset)) }
  } catch (error) {
    console.error('[directory] failed to load destination', iso2, error instanceof Error ? error.message : error)
    return { state: 'error' }
  }
}
