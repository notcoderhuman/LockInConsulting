import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getPublishBlockers, getRankingPublishBlockers, todayIso } from '@/lib/data/publication'
import type { RankingProviderRights, RightsStatus, VerifiableRecord } from '@/lib/data/types'
import {
  fxProviderTermsInput,
  fxRateInput,
  rankingRightsInput,
  reasonInput,
  sourceCaptureInput,
  verificationInput,
} from '@/lib/data/validation'
import { z } from 'zod'
import { appendChangeLog, type LogAction } from './audit'
import { ENTITIES, type EntityDef, type EntityKey } from './entities'
import { formId, formText, parseEntityForm, type FieldErrors } from './forms'
import { can, type AdminActor, type Permission } from './roles'

// Every admin mutation goes through this module. Each one: checks the actor's permission,
// validates input with lib/data/validation.ts, locks the row, applies the change and appends the
// hash-chained audit entry in ONE transaction. The CHECK constraints are the final backstop.

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: FieldErrors = {},
    readonly blockers: string[] = [],
  ) {
    super(message)
    this.name = 'WorkflowError'
  }
}

export class PermissionError extends Error {
  constructor(readonly permission: Permission) {
    super('You do not have permission to do this.')
    this.name = 'PermissionError'
  }
}

type Row = RowDataPacket & Record<string, unknown>

function assertCan(actor: AdminActor, permission: Permission) {
  if (!can(actor.role, permission)) throw new PermissionError(permission)
}

const zodFieldErrors = (e: z.ZodError): FieldErrors => ({ ...z.flattenError(e).fieldErrors })

function nowUtc(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/** Converts driver errors into messages an editor can act on. Never leaks SQL. */
function translateDbError(error: unknown): never {
  if (error instanceof WorkflowError || error instanceof PermissionError) throw error
  const e = error as { code?: string; errno?: number; sqlMessage?: string }
  // MySQL 3819 ER_CHECK_CONSTRAINT_VIOLATED; MariaDB 4025 ER_CONSTRAINT_FAILED.
  if (e.errno === 3819 || e.errno === 4025) {
    const name = /constraint [`'"]?([a-z0-9_]+)/i.exec(e.sqlMessage ?? '')?.[1] ?? 'a data rule'
    throw new WorkflowError(`The database rejected this change (${name}).`)
  }
  // MySQL/MariaDB 1644 ER_SIGNAL_EXCEPTION (from append-only immutability triggers).
  if (e.errno === 1644 || e.code === 'ER_SIGNAL_EXCEPTION')
    throw new WorkflowError(e.sqlMessage || 'This table is append-only and cannot be modified.')
  if (e.code === 'ER_DUP_ENTRY') throw new WorkflowError('A record with the same unique value (slug or URL) already exists.')
  if (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW')
    throw new WorkflowError('A linked record (source, parent or provider) does not exist.')
  if (e.code === 'ER_ROW_IS_REFERENCED_2' || e.code === 'ER_ROW_IS_REFERENCED')
    throw new WorkflowError('This record is still referenced by other records.')
  throw error
}

async function inTransaction<T>(db: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const result = await work(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback().catch(() => {})
    translateDbError(error)
  } finally {
    conn.release()
  }
}

async function lockRow(conn: PoolConnection, def: EntityDef, id: number): Promise<Row> {
  const [[row]] = await conn.query<Row[]>(`SELECT * FROM ${def.table} WHERE id = ? FOR UPDATE`, [id])
  if (!row) throw new WorkflowError(`${def.label} not found.`)
  return row
}

async function readRow(conn: PoolConnection, table: string, id: number): Promise<Row> {
  const [[row]] = await conn.query<Row[]>(`SELECT * FROM ${table} WHERE id = ?`, [id])
  return row
}

const str = (v: unknown) => (v == null ? null : String(v))

export function toVerifiable(entity: EntityKey, row: Record<string, unknown>): VerifiableRecord {
  return {
    publicationStatus: row.publication_status as VerifiableRecord['publicationStatus'],
    verificationStatus: row.verification_status as VerifiableRecord['verificationStatus'],
    sourceId: row.source_id == null ? null : Number(row.source_id),
    checkedAt: str(row.checked_at),
    verifiedAt: str(row.verified_at),
    verifiedBy: str(row.verified_by),
    reviewDueAt: str(row.review_due_at),
    ...(entity === 'tuition_fee' ? { validTo: str(row.valid_to) } : {}),
  }
}

/** Rules beyond lib/data/publication.ts that the CHECK constraints also enforce, per entity. */
function valueBlockers(def: EntityDef, row: Record<string, unknown>, status: string): string[] {
  const blockers: string[] = []
  if (def.valueColumn) {
    const empty = row[def.valueColumn] == null
    if (status === 'verified' && empty) blockers.push('A verified record needs its published value. Edit the draft to add it.')
    if (status === 'unavailable' && !empty) blockers.push('Clear the value before marking it as not publicly available.')
  }
  if (status === 'unavailable' && !def.allowUnavailable) blockers.push(`A ${def.label.toLowerCase()} cannot be marked "not available".`)
  if (def.key === 'tuition_fee' && status === 'verified' && !row.academic_year && !row.valid_to)
    blockers.push('A verified fee needs an academic year or a valid-to date.')
  return blockers
}

export interface PublishReadiness {
  blockers: string[]
  warnings: string[]
  /** Whether the record is currently returned by its public_* view. null = no public view. */
  live: boolean | null
}

/**
 * Explains why a record can or can't be published. The rules come from lib/data/publication.ts
 * (which mirrors the CHECK constraints) and the live state is read from the public_* view itself.
 */
export async function getPublishReadiness(
  db: Pick<Pool, 'query'>,
  entity: EntityKey,
  row: Record<string, unknown>,
  today = todayIso(),
): Promise<PublishReadiness> {
  const def = ENTITIES[entity]
  const record = toVerifiable(entity, row)
  const blockers: string[] = []
  const warnings: string[] = []

  if (record.publicationStatus === 'published') blockers.push('Already published.')
  else if (record.publicationStatus !== 'in_review') blockers.push('Submit the record for review first.')

  if (entity === 'university_ranking') {
    const [[p]] = await db.query<Row[]>('SELECT name, rights_status, licence_expires_at FROM ranking_providers WHERE id = ?', [row.provider_id])
    const provider: RankingProviderRights = {
      name: String(p?.name ?? 'Unknown provider'),
      rightsStatus: (p?.rights_status as RightsStatus) ?? 'not_confirmed',
      licenceExpiresAt: str(p?.licence_expires_at),
    }
    blockers.push(...getRankingPublishBlockers(record, provider, today))
  } else {
    blockers.push(...getPublishBlockers(record, today, { allowUnavailable: def.allowUnavailable }))
  }
  if (record.verificationStatus !== 'unverified') blockers.push(...valueBlockers(def, row, record.verificationStatus))
  if (entity === 'university' && !row.official_website) blockers.push('Add the official website.')

  if (def.parent) {
    const parentDef = ENTITIES[def.parent.entity]
    if (parentDef.publicView) {
      const [live] = await db.query<Row[]>(`SELECT 1 AS ok FROM ${parentDef.publicView} WHERE id = ?`, [row[def.parent.column]])
      if (!live.length) warnings.push(`The parent ${parentDef.label.toLowerCase()} is not live, so this won't appear publicly until it is.`)
    }
  }

  let live: boolean | null = null
  if (def.publicView) {
    const [found] = await db.query<Row[]>(`SELECT 1 AS ok FROM ${def.publicView} WHERE id = ?`, [row.id])
    live = found.length > 0
  }
  return { blockers: [...new Set(blockers)], warnings, live }
}

// ---------------------------------------------------------------------------------------------
// Capture and edit
// ---------------------------------------------------------------------------------------------

async function assertParentLinks(conn: PoolConnection, entity: EntityKey, row: Record<string, unknown>) {
  const def = ENTITIES[entity]
  if (def.parent) {
    const parentDef = ENTITIES[def.parent.entity]
    const [found] = await conn.query<Row[]>(`SELECT id FROM ${parentDef.table} WHERE id = ?`, [row[def.parent.column]])
    if (!found.length) throw new WorkflowError(`The parent ${parentDef.label.toLowerCase()} does not exist.`)
  }
  if (entity === 'course' && row.campus_id != null) {
    const [ok] = await conn.query<Row[]>('SELECT id FROM campuses WHERE id = ? AND university_id = ?', [row.campus_id, row.university_id])
    if (!ok.length) throw new WorkflowError('That campus belongs to a different university.', { campusId: ['Choose a campus of this university.'] })
  }
  if (entity === 'acceptance_rate' && row.course_id != null) {
    const [ok] = await conn.query<Row[]>('SELECT id FROM courses WHERE id = ? AND university_id = ?', [row.course_id, row.university_id])
    if (!ok.length) throw new WorkflowError('That course belongs to a different university.', { courseId: ['Choose a course of this university.'] })
  }
}

export async function createRecord(db: Pool, actor: AdminActor, entity: EntityKey, form: FormData, parentId: number | null): Promise<number> {
  assertCan(actor, 'data.capture')
  const def = ENTITIES[entity]
  if (def.parent && parentId == null) throw new WorkflowError(`Choose the ${ENTITIES[def.parent.entity].label.toLowerCase()} first.`)
  const parsed = parseEntityForm(entity, form, parentId)
  if (!parsed.ok) throw new WorkflowError('Check the highlighted fields.', parsed.fieldErrors)

  return inTransaction(db, async (conn) => {
    await assertParentLinks(conn, entity, parsed.row)
    // Captured records always start as draft/unverified, whatever the form contains.
    const [res] = await conn.query<ResultSetHeader>(`INSERT INTO ${def.table} SET ?`, [
      { ...parsed.row, publication_status: 'draft', verification_status: 'unverified' },
    ])
    const after = await readRow(conn, def.table, res.insertId)
    await appendChangeLog(conn, { entityType: def.logType, entityId: res.insertId, action: 'create', actorId: actor.userId, actorRole: actor.role, reason: null, before: null, after })
    return res.insertId
  })
}

export async function updateRecord(db: Pool, actor: AdminActor, entity: EntityKey, id: number, form: FormData): Promise<void> {
  assertCan(actor, 'data.capture')
  const def = ENTITIES[entity]
  await inTransaction(db, async (conn) => {
    const before = await lockRow(conn, def, id)
    if (before.publication_status === 'published') throw new WorkflowError('Unpublish this record before editing it.')
    const parentId = def.parent ? Number(before[def.parent.column]) : null
    const parsed = parseEntityForm(entity, form, parentId)
    if (!parsed.ok) throw new WorkflowError('Check the highlighted fields.', parsed.fieldErrors)
    await assertParentLinks(conn, entity, parsed.row)
    // Any edit changes the facts, so the previous verification no longer applies.
    await conn.query(`UPDATE ${def.table} SET ? WHERE id = ?`, [
      {
        ...parsed.row,
        verification_status: 'unverified',
        verified_at: null,
        verified_by: null,
        publication_status: before.publication_status === 'in_review' ? 'draft' : before.publication_status,
      },
      id,
    ])
    const after = await readRow(conn, def.table, id)
    await appendChangeLog(conn, { entityType: def.logType, entityId: id, action: 'update', actorId: actor.userId, actorRole: actor.role, reason: null, before, after })
  })
}

// ---------------------------------------------------------------------------------------------
// capture → review → verify → publish → re-verify → unpublish
// ---------------------------------------------------------------------------------------------

export type WorkflowAction = 'submit_for_review' | 'return_to_draft' | 'verify' | 'publish' | 'unpublish'

export const ACTION_PERMISSION: Record<WorkflowAction, Permission> = {
  submit_for_review: 'data.capture',
  return_to_draft: 'data.review',
  verify: 'data.review',
  publish: 'data.review',
  unpublish: 'data.review',
}

/** Which workflow buttons make sense for this record and role (UI only; the server re-checks). */
export function availableActions(row: Record<string, unknown>, role: AdminActor['role']): WorkflowAction[] {
  const status = row.publication_status
  const actions: WorkflowAction[] = []
  if (status === 'draft' || status === 'unpublished') actions.push('submit_for_review')
  if (status === 'in_review') actions.push('verify', 'publish', 'return_to_draft')
  if (status === 'published') actions.push('verify', 'unpublish')
  return actions.filter((a) => can(role, ACTION_PERMISSION[a]))
}

export async function transitionRecord(
  db: Pool,
  actor: AdminActor,
  entity: EntityKey,
  id: number,
  action: WorkflowAction,
  form: FormData,
): Promise<void> {
  if (!(action in ACTION_PERMISSION)) throw new WorkflowError('Unknown action.')
  assertCan(actor, ACTION_PERMISSION[action])
  const def = ENTITIES[entity]
  const today = todayIso()

  await inTransaction(db, async (conn) => {
    const before = await lockRow(conn, def, id)
    const status = before.publication_status
    let changes: Record<string, unknown>
    let logAction: LogAction = action
    let reason: string | null = null

    switch (action) {
      case 'submit_for_review': {
        if (status !== 'draft' && status !== 'unpublished') throw new WorkflowError('Only drafts and unpublished records can be submitted for review.')
        changes = { publication_status: 'in_review' }
        break
      }
      case 'return_to_draft': {
        if (status !== 'in_review') throw new WorkflowError('Only records in review can be returned to draft.')
        const r = reasonInput.safeParse(formText(form, 'reason'))
        if (!r.success) throw new WorkflowError('Give a reason.', { reason: r.error.issues.map((i) => i.message) })
        reason = r.data
        changes = { publication_status: 'draft' }
        break
      }
      case 'verify': {
        if (status !== 'in_review' && status !== 'published') throw new WorkflowError('Submit the record for review before verifying it.')
        const v = verificationInput(today).safeParse({
          verificationStatus: formText(form, 'verificationStatus'),
          sourceId: formId(form, 'sourceId') ?? undefined,
          checkedAt: formText(form, 'checkedAt'),
          reviewDueAt: formText(form, 'reviewDueAt'),
          verifiedBy: actor.userId,
          notes: formText(form, 'notes') || undefined,
        })
        if (!v.success) throw new WorkflowError('Check the verification details.', zodFieldErrors(v.error))
        const blockers = valueBlockers(def, before, v.data.verificationStatus)
        if (blockers.length) throw new WorkflowError(blockers[0], {}, blockers)
        const [src] = await conn.query<Row[]>('SELECT id FROM sources WHERE id = ?', [v.data.sourceId])
        if (!src.length) throw new WorkflowError('That source does not exist.', { sourceId: ['Choose a recorded source.'] })
        changes = {
          verification_status: v.data.verificationStatus,
          source_id: v.data.sourceId,
          checked_at: v.data.checkedAt,
          review_due_at: v.data.reviewDueAt,
          verified_at: nowUtc(),
          verified_by: actor.userId,
          verification_notes: v.data.notes ?? null,
        }
        logAction = status === 'published' ? 'reverify' : v.data.verificationStatus === 'unavailable' ? 'mark_unavailable' : 'verify'
        break
      }
      case 'publish': {
        const readiness = await getPublishReadiness(conn, entity, before, today)
        if (readiness.blockers.length) throw new WorkflowError('This record cannot be published yet.', {}, readiness.blockers)
        changes = { publication_status: 'published', unpublished_reason: null }
        break
      }
      case 'unpublish': {
        if (status !== 'published') throw new WorkflowError('Only published records can be unpublished.')
        const r = reasonInput.safeParse(formText(form, 'reason'))
        if (!r.success) throw new WorkflowError('Give a reason.', { reason: r.error.issues.map((i) => i.message) })
        reason = r.data
        changes = { publication_status: 'unpublished', unpublished_reason: r.data }
        break
      }
    }

    // The status predicate guards against two reviewers acting on the same row at once.
    const [res] = await conn.query<ResultSetHeader>(`UPDATE ${def.table} SET ? WHERE id = ? AND publication_status = ?`, [changes, id, status])
    if (res.affectedRows !== 1) throw new WorkflowError('This record changed while you were working. Reload and try again.')
    const after = await readRow(conn, def.table, id)
    await appendChangeLog(conn, { entityType: def.logType, entityId: id, action: logAction, actorId: actor.userId, actorRole: actor.role, reason, before, after })
  })
}

// ---------------------------------------------------------------------------------------------
// Sources, ranking rights, exchange rates
// ---------------------------------------------------------------------------------------------

export async function createSource(db: Pool, actor: AdminActor, form: FormData): Promise<number> {
  assertCan(actor, 'data.capture')
  const parsed = sourceCaptureInput(todayIso()).safeParse({
    url: formText(form, 'url'),
    title: formText(form, 'title'),
    publisher: formText(form, 'publisher'),
    sourceType: formText(form, 'sourceType'),
    retrievedAt: formText(form, 'retrievedAt'),
    notes: formText(form, 'notes') || undefined,
  })
  if (!parsed.success) throw new WorkflowError('Check the highlighted fields.', zodFieldErrors(parsed.error))
  const s = parsed.data
  return inTransaction(db, async (conn) => {
    const [res] = await conn.query<ResultSetHeader>(
      'INSERT INTO sources (url, title, publisher, source_type, retrieved_at, notes, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [s.url, s.title, s.publisher, s.sourceType, s.retrievedAt, s.notes ?? null, actor.userId],
    )
    const after = await readRow(conn, 'sources', res.insertId)
    await appendChangeLog(conn, { entityType: 'source', entityId: res.insertId, action: 'create', actorId: actor.userId, actorRole: actor.role, reason: null, before: null, after })
    return res.insertId
  })
}

export async function updateRankingRights(db: Pool, actor: AdminActor, providerId: number, form: FormData): Promise<void> {
  assertCan(actor, 'rights.manage')
  const parsed = rankingRightsInput.safeParse({
    rightsStatus: formText(form, 'rightsStatus'),
    licenceReference: formText(form, 'licenceReference') || undefined,
    licenceScope: formText(form, 'licenceScope') || undefined,
    licenceExpiresAt: formText(form, 'licenceExpiresAt') || undefined,
    rightsCheckedAt: formText(form, 'rightsCheckedAt') || undefined,
    rightsNotes: formText(form, 'rightsNotes') || undefined,
  })
  if (!parsed.success) throw new WorkflowError('Check the highlighted fields.', zodFieldErrors(parsed.error))
  const r = parsed.data
  const reason = formText(form, 'reason') || null
  await inTransaction(db, async (conn) => {
    const [[before]] = await conn.query<Row[]>('SELECT * FROM ranking_providers WHERE id = ? FOR UPDATE', [providerId])
    if (!before) throw new WorkflowError('Ranking provider not found.')
    await conn.query(
      `UPDATE ranking_providers SET rights_status = ?, licence_reference = ?, licence_scope = ?, licence_expires_at = ?,
              rights_checked_at = ?, rights_notes = ? WHERE id = ?`,
      [r.rightsStatus, r.licenceReference ?? null, r.licenceScope ?? null, r.licenceExpiresAt ?? null, r.rightsCheckedAt ?? null, r.rightsNotes ?? null, providerId],
    )
    const after = await readRow(conn, 'ranking_providers', providerId)
    await appendChangeLog(conn, { entityType: 'ranking_provider', entityId: providerId, action: 'rights_change', actorId: actor.userId, actorRole: actor.role, reason, before, after })
  })
}

export async function updateFxProviderTerms(db: Pool, actor: AdminActor, providerId: number, form: FormData): Promise<void> {
  assertCan(actor, 'rights.manage')
  const parsed = fxProviderTermsInput.safeParse({
    termsStatus: formText(form, 'termsStatus'),
    currenciesCovered: formText(form, 'currenciesCovered') || undefined,
    attributionText: formText(form, 'attributionText') || undefined,
    updateFrequency: formText(form, 'updateFrequency') || undefined,
    termsCheckedAt: formText(form, 'termsCheckedAt') || undefined,
    termsNotes: formText(form, 'termsNotes') || undefined,
  })
  if (!parsed.success) throw new WorkflowError('Check the highlighted fields.', zodFieldErrors(parsed.error))
  const p = parsed.data
  const reason = formText(form, 'reason') || null
  await inTransaction(db, async (conn) => {
    const [[before]] = await conn.query<Row[]>('SELECT * FROM fx_providers WHERE id = ? FOR UPDATE', [providerId])
    if (!before) throw new WorkflowError('Exchange-rate provider not found.')
    await conn.query(
      `UPDATE fx_providers SET terms_status = ?, currencies_covered = ?, attribution_text = ?, update_frequency = ?,
              terms_checked_at = ?, terms_reviewed_by = ?, terms_notes = ? WHERE id = ?`,
      [p.termsStatus, p.currenciesCovered ?? null, p.attributionText ?? null, p.updateFrequency ?? null, p.termsCheckedAt ?? null, actor.userId, p.termsNotes ?? null, providerId],
    )
    const after = await readRow(conn, 'fx_providers', providerId)
    await appendChangeLog(conn, { entityType: 'fx_provider', entityId: providerId, action: 'terms_change', actorId: actor.userId, actorRole: actor.role, reason, before, after })
  })
}

export async function createFxRate(db: Pool, actor: AdminActor, form: FormData): Promise<number> {
  assertCan(actor, 'data.review')
  const parsed = fxRateInput(todayIso()).safeParse({
    providerId: formId(form, 'providerId') ?? undefined,
    sourceId: formId(form, 'sourceId') ?? undefined,
    baseCurrency: formText(form, 'baseCurrency'),
    rate: formText(form, 'rate'),
    rateDate: formText(form, 'rateDate'),
  })
  if (!parsed.success) throw new WorkflowError('Check the highlighted fields.', zodFieldErrors(parsed.error))
  const f = parsed.data
  return inTransaction(db, async (conn) => {
    const [[provider]] = await conn.query<Row[]>('SELECT terms_status FROM fx_providers WHERE id = ?', [f.providerId])
    if (!provider) throw new WorkflowError('Exchange-rate provider not found.')
    if (provider.terms_status !== 'approved')
      throw new WorkflowError('This provider’s terms have not been approved. INR estimates stay unavailable until an owner approves them.')
    const [[source]] = await conn.query<Row[]>('SELECT source_type FROM sources WHERE id = ?', [f.sourceId])
    if (!source || source.source_type !== 'exchange_rate_provider')
      throw new WorkflowError('Choose a source of type "exchange rate provider".', { sourceId: ['Choose an exchange-rate source.'] })
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO fx_rates (base_currency, quote_currency, rate, rate_date, source_id, provider_id, entered_by)
       VALUES (?, 'INR', ?, ?, ?, ?, ?)`,
      [f.baseCurrency, f.rate, f.rateDate, f.sourceId, f.providerId, actor.userId],
    )
    const after = await readRow(conn, 'fx_rates', res.insertId)
    await appendChangeLog(conn, { entityType: 'fx_rate', entityId: res.insertId, action: 'create', actorId: actor.userId, actorRole: actor.role, reason: null, before: null, after })
    return res.insertId
  })
}
