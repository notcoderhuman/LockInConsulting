import type { Pool, PoolConnection } from 'mysql2/promise'
import { z } from 'zod'
import { appendChangeLog } from '@/lib/admin/audit'
import type { AdminActor } from '@/lib/admin/roles'
import { getDerekStatus, type DerekStatus } from '@/lib/derek/config'
import { assertActor, inTransaction, selectRows, SupportError } from './db'

// Owner-controlled support mode. "online" = humans answer (Derek may only prepare drafts for
// review); "offline" = Derek MAY auto-reply, but only when automatic replies are switched on
// here AND fully permitted by lib/derek/config.ts at the moment of sending.

export type SupportMode = 'online' | 'offline'

export interface SupportSettings {
  mode: SupportMode
  autoReplyEnabled: boolean
  updatedBy: string | null
  updatedAt: string
}

type Db = Pick<Pool, 'query'> | PoolConnection

export async function getSupportSettings(db: Db, { forUpdate = false } = {}): Promise<SupportSettings> {
  const [row] = await selectRows(db, `SELECT * FROM support_settings WHERE id = 1${forUpdate ? ' FOR UPDATE' : ''}`)
  // Missing row (should not happen after 0003): fail safe to human-only support.
  if (!row) return { mode: 'online', autoReplyEnabled: false, updatedBy: null, updatedAt: '' }
  return {
    mode: row.support_mode === 'offline' ? 'offline' : 'online',
    autoReplyEnabled: Number(row.auto_reply_enabled) === 1,
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
    updatedAt: String(row.updated_at),
  }
}

/** True only when every gate allows sending an unreviewed Derek reply right now. */
export function autoReplyActive(settings: SupportSettings, derek: DerekStatus): boolean {
  return settings.mode === 'offline' && settings.autoReplyEnabled && derek.state === 'ready' && derek.autoReply.permitted
}

const settingsInput = z.object({
  mode: z.enum(['online', 'offline']),
  autoReplyEnabled: z.boolean(),
})

export async function updateSupportSettings(pool: Pool, actor: AdminActor, input: unknown, derek: DerekStatus = getDerekStatus()): Promise<SupportSettings> {
  assertActor(actor, 'support.settings')
  const parsed = settingsInput.safeParse(input)
  if (!parsed.success) throw new SupportError(400, 'Choose a support mode.')
  const { mode, autoReplyEnabled } = parsed.data
  if (autoReplyEnabled && !derek.autoReply.permitted)
    throw new SupportError(409, `Automatic replies cannot be enabled: ${derek.autoReply.blockers.join(' ')}`)
  return inTransaction(pool, async (conn) => {
    const before = await getSupportSettings(conn, { forUpdate: true })
    await conn.query('UPDATE support_settings SET support_mode = ?, auto_reply_enabled = ?, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = 1', [
      mode,
      autoReplyEnabled,
      actor.userId,
    ])
    await appendChangeLog(conn, {
      entityType: 'support_settings',
      entityId: 1,
      action: 'settings_change',
      actorId: actor.userId,
      actorRole: actor.role,
      reason: null,
      before: { mode: before.mode, autoReplyEnabled: before.autoReplyEnabled },
      after: { mode, autoReplyEnabled },
    })
    return getSupportSettings(conn)
  })
}
