import type { Pool, PoolConnection } from 'mysql2/promise'
import { z } from 'zod'
import { appendChangeLog } from '@/lib/admin/audit'
import type { AdminActor } from '@/lib/admin/roles'
import type { DerekStatus } from '@/lib/derek/config'
import { assertActor, inTransaction, selectRows, SupportError } from './db'

// Owner-controlled automatic replies: a kill switch that is ON by default (0005). While it is on,
// Derek sends routine low-risk answers himself, but only when lib/derek/config.ts permits the
// provider at the moment of sending; LockIn's own fixed replies (greeting, thanks, scope) need no
// provider clearance. `mode` (online/offline) is kept for the record but no longer gates anything:
// ordinary questions are answered at any hour, and risky ones wait for a person either way.

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
  return settings.autoReplyEnabled && derek.state === 'ready' && derek.autoReply.permitted
}

const settingsInput = z.object({
  mode: z.enum(['online', 'offline']).optional(),
  autoReplyEnabled: z.boolean(),
})

export async function updateSupportSettings(pool: Pool, actor: AdminActor, input: unknown): Promise<SupportSettings> {
  assertActor(actor, 'support.settings')
  const parsed = settingsInput.safeParse(input)
  if (!parsed.success) throw new SupportError(400, 'Choose whether automatic replies are on.')
  // Turning the switch on never sends model-written text by itself: autoReplyActive() still needs
  // a cleared provider at the moment of sending.
  const { autoReplyEnabled } = parsed.data
  return inTransaction(pool, async (conn) => {
    const before = await getSupportSettings(conn, { forUpdate: true })
    const mode = parsed.data.mode ?? before.mode
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
