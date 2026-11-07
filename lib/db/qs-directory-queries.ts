import type { Pool, RowDataPacket } from 'mysql2/promise'

type Db = Pick<Pool, 'query'>

/** What a public card may carry: the university's name, its QS rank as printed, and LockIn's own verification. */
export interface QsCard {
  name: string
  rank: string
  verified: boolean
}

export interface QsPage {
  cards: QsCard[]
  /** Universities matching the search in this destination (never more than 50 without a search). */
  total: number
  /** The directory has any entry at all: false until the QS licence is recorded as executed. */
  published: boolean
}

export const QS_PAGE_SIZE = 25

/** "#4", "=45", "731-740", "1401+": the label QS prints, else the position as "#n". */
export const rankText = (label: unknown, order: unknown): string => (label != null && /^[=]|[-+]/.test(String(label)) ? String(label) : `#${order}`)

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * One page of the public directory for one destination, in QS global order. Reads only public_qs_directory, which
 * enforces the QS licence, the 50-per-destination cut and the hidden/archived flag in the database. `verified`
 * comes from the university's own publication status, never from a rank or a website check.
 */
export async function fetchQsPage(db: Db, iso2: string, q: string, offset: number): Promise<QsPage> {
  const like = q ? `%${escapeLike(q)}%` : '%'
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT name, rank_order, rank_label, verified FROM public_qs_directory
      WHERE destination_iso2 = ? AND name LIKE ?
      ORDER BY rank_order, name, id LIMIT ? OFFSET ?`,
    [iso2, like, QS_PAGE_SIZE, offset],
  )
  const [[count]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM public_qs_directory WHERE destination_iso2 = ? AND name LIKE ?', [iso2, like])
  const [[any]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM public_qs_directory')
  return {
    cards: rows.map((r) => ({ name: String(r.name), rank: rankText(r.rank_label, r.rank_order), verified: Number(r.verified) === 1 })),
    total: Number(count.n),
    published: Number(any.n) > 0,
  }
}
