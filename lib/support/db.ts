import { createHash } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { actorCan, type AdminActor, type Permission } from '@/lib/admin/roles'

// Shared plumbing for lib/support and lib/derek. Errors carry an HTTP-style status and a message
// that is safe to show; SQL and driver details are never surfaced.

export type Row = RowDataPacket & Record<string, unknown>

export class SupportError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429 | 503,
    message: string,
    readonly fieldErrors: Record<string, string[] | undefined> = {},
  ) {
    super(message)
    this.name = 'SupportError'
  }
}

export function assertActor(actor: AdminActor, permission: Permission) {
  if (!actorCan(actor, permission)) throw new SupportError(403, 'You do not have permission to do this.')
}

export const isDuplicate = (e: unknown) => (e as { code?: string })?.code === 'ER_DUP_ENTRY'

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

export async function inTransaction<T>(db: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const result = await work(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback().catch(() => {})
    if (error instanceof SupportError) throw error
    const e = error as { errno?: number; code?: string }
    // CHECK violations and append-only triggers: the request was invalid, nothing was saved.
    if (e.errno === 3819 || e.errno === 4025 || e.errno === 1644) throw new SupportError(400, 'The database rejected this change. Nothing was saved.')
    if (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') throw new SupportError(409, 'Someone else changed this conversation at the same time. Try again.')
    throw error
  } finally {
    conn.release()
  }
}

export async function selectRows(db: Pick<Pool, 'query'> | PoolConnection, sql: string, params: unknown[] = []): Promise<Row[]> {
  const [rows] = await db.query<Row[]>(sql, params)
  return rows
}

export const nowMs = () => new Date().toISOString().slice(0, 23).replace('T', ' ')
