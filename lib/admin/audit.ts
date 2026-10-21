import type { Pool, PoolConnection } from 'mysql2/promise'
import { appendChangeLogRow, canonicalJson, computeRowHash, GENESIS_HASH, verifyAuditChain as verifyAuditChainCore } from './audit-core.mjs'
import type { AdminRole } from './roles'

export { canonicalJson, computeRowHash, GENESIS_HASH }

export type LogEntityType =
  | 'source'
  | 'university'
  | 'campus'
  | 'course'
  | 'course_intake'
  | 'tuition_fee'
  | 'fx_rate'
  | 'acceptance_rate'
  | 'ranking_provider'
  | 'university_ranking'
  | 'fx_provider'
  | 'admin_member'
  | 'conversation'
  | 'ai_draft'
  | 'support_settings'
  | 'student_profile'

export type LogAction =
  | 'create'
  | 'update'
  | 'submit_for_review'
  | 'verify'
  | 'mark_unavailable'
  | 'publish'
  | 'unpublish'
  | 'rights_change'
  | 'return_to_draft'
  | 'reverify'
  | 'terms_change'
  | 'role_grant'
  | 'role_revoke'
  | 'staff_reply'
  | 'status_change'
  | 'draft_edit'
  | 'draft_approve'
  | 'draft_reject'
  | 'draft_send'
  | 'settings_change'
  | 'support_grant'
  | 'support_revoke'
  | 'student_erase'

export interface ChangeLogEntry {
  entityType: LogEntityType
  entityId: number
  action: LogAction
  actorId: string
  actorRole: AdminRole | 'cli' | 'derek' | 'system' | null
  reason: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/** Must be called inside the same transaction as the change it records. */
export function appendChangeLog(conn: PoolConnection, entry: ChangeLogEntry): Promise<number> {
  return appendChangeLogRow(conn, entry)
}

export type ChainVerification =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenAtId: number | null; reason: string }

/** Recomputes every hash. Requires a connection opened with `dateStrings: true`. */
export function verifyAuditChain(db: Pick<Pool, 'query'>): Promise<ChainVerification> {
  return verifyAuditChainCore(db) as Promise<ChainVerification>
}
