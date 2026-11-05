import { createHash } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { todayIso } from '@/lib/data/publication'
import { SOURCE_TYPES } from '@/lib/data/types'
import { academicYear, courseInput, httpsUrl, intakeInput, isoDate, reasonInput, tuitionFeeInput, universityInput } from '@/lib/data/validation'
import { appendChangeLog } from './audit'
import { ENTITIES, type EntityKey } from './entities'
import { formText, parseEntityForm, type FieldErrors } from './forms'
import { can, type AdminActor, type Permission } from './roles'
import { inTransaction, PermissionError, readRow, transitionRecord, WorkflowError } from './workflow'

// Bulk import, duplicate detection, conflict resolution, bulk verification and academic years.
// Same rules as lib/admin/workflow.ts: permission check, validation with lib/data/validation.ts,
// one transaction per change, a hash-chained audit entry for every write. Nothing here can mark a
// record verified except bulkVerify, which runs the normal single-record verify for each id.

type Row = RowDataPacket & Record<string, unknown>

function assertCan(actor: AdminActor, permission: Permission) {
  if (!can(actor.role, permission)) throw new PermissionError(permission)
}

const dateText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v))

// ---------------------------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------------------------

/** Name key for duplicate matching: accents, case, punctuation, "&" and a leading "The" are ignored. */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

/** Host of an official website without "www.", or null. */
export function websiteHost(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

export interface UniversityKey {
  id: number
  destinationIso2: string
  name: string
  officialWebsite: string | null
}

export interface DuplicatePair {
  a: number
  b: number
  reason: string
}

/** Pairs of universities in the same destination with the same normalised name or website host. */
export function findDuplicatePairs(rows: UniversityKey[]): DuplicatePair[] {
  const groups = new Map<string, { ids: number[]; reason: string }>()
  const add = (key: string, id: number, reason: string) => {
    const g = groups.get(key) ?? { ids: [], reason }
    g.ids.push(id)
    groups.set(key, g)
  }
  for (const r of rows) {
    add(`${r.destinationIso2}|name|${normaliseName(r.name)}`, r.id, 'same name')
    const host = websiteHost(r.officialWebsite)
    if (host) add(`${r.destinationIso2}|host|${host}`, r.id, `same website (${host})`)
  }
  const pairs = new Map<string, DuplicatePair>()
  for (const { ids, reason } of groups.values()) {
    const sorted = [...new Set(ids)].sort((x, y) => x - y)
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`
        const existing = pairs.get(key)
        pairs.set(key, { a: sorted[i], b: sorted[j], reason: existing ? `${existing.reason}; ${reason}` : reason })
      }
  }
  return [...pairs.values()]
}

/** Records each newly found duplicate pair as an open conflict. A pair already recorded (any status) is skipped. */
export async function scanDuplicates(db: Pool, actor: AdminActor): Promise<number> {
  assertCan(actor, 'data.capture')
  return inTransaction(db, async (conn) => {
    const [unis] = await conn.query<Row[]>('SELECT id, destination_iso2, name, official_website FROM universities')
    const pairs = findDuplicatePairs(unis.map((u) => ({ id: Number(u.id), destinationIso2: String(u.destination_iso2), name: String(u.name), officialWebsite: u.official_website == null ? null : String(u.official_website) })))
    const [known] = await conn.query<Row[]>("SELECT entity_id, other_entity_id FROM data_conflicts WHERE kind = 'duplicate' AND entity_type = 'university' FOR UPDATE")
    const seen = new Set(known.map((k) => [Number(k.entity_id), Number(k.other_entity_id)].sort((x, y) => x - y).join('-')))
    let added = 0
    for (const p of pairs) {
      if (seen.has(`${p.a}-${p.b}`)) continue
      await insertConflict(conn, actor, { kind: 'duplicate', entity_type: 'university', entity_id: p.a, other_entity_id: p.b, detail: `Possible duplicate: ${p.reason}`.slice(0, 500) })
      added++
    }
    return added
  })
}

async function insertConflict(conn: PoolConnection, actor: AdminActor, row: Record<string, unknown>): Promise<number> {
  const [res] = await conn.query<ResultSetHeader>('INSERT INTO data_conflicts SET ?', [row])
  const after = await readRow(conn, 'data_conflicts', res.insertId)
  await appendChangeLog(conn, { entityType: 'data_conflict', entityId: res.insertId, action: 'create', actorId: actor.userId, actorRole: actor.role, reason: null, before: null, after })
  return res.insertId
}

// ---------------------------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------------------------

const OUTCOMES = {
  duplicate: ['not_duplicate', 'duplicate_confirmed', 'dismissed'],
  field_value: ['kept_current', 'accepted_proposed', 'dismissed'],
} as const

/**
 * Resolves one open conflict with a reason. Accepting a proposed value edits the record through the
 * same validation as the edit form, resets its verification, and records the proposed source for that
 * field. A published record must be unpublished first. A confirmed duplicate is only recorded: merging
 * or unpublishing the extra record stays a normal, separate workflow step.
 */
export async function resolveConflict(db: Pool, actor: AdminActor, id: number, form: FormData): Promise<void> {
  assertCan(actor, 'data.review')
  const outcome = formText(form, 'outcome')
  const note = reasonInput.safeParse(formText(form, 'note'))
  if (!note.success) throw new WorkflowError('Give a reason.', { note: note.error.issues.map((i) => i.message) })
  await inTransaction(db, async (conn) => {
    const [[before]] = await conn.query<Row[]>('SELECT * FROM data_conflicts WHERE id = ? FOR UPDATE', [id])
    if (!before) throw new WorkflowError('Conflict not found.')
    if (before.status !== 'open') throw new WorkflowError('This conflict is already resolved.')
    const allowed: readonly string[] = OUTCOMES[before.kind as keyof typeof OUTCOMES]
    if (!allowed.includes(outcome)) throw new WorkflowError('Choose a valid outcome.', { outcome: ['Choose a valid outcome.'] })
    if (outcome === 'accepted_proposed') await applyProposedValue(conn, actor, before, note.data)
    await conn.query('UPDATE data_conflicts SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ?', [outcome, note.data, actor.userId, id])
    const after = await readRow(conn, 'data_conflicts', id)
    await appendChangeLog(conn, { entityType: 'data_conflict', entityId: id, action: 'resolve_conflict', actorId: actor.userId, actorRole: actor.role, reason: note.data, before, after })
  })
}

async function applyProposedValue(conn: PoolConnection, actor: AdminActor, conflict: Row, reason: string) {
  const entity = String(conflict.entity_type) as EntityKey
  const def = ENTITIES[entity]
  const field = def?.fields.find((f) => f.column === conflict.field_name && f.kind !== 'source')
  if (!def || !field) throw new WorkflowError('This field cannot be changed from the conflict queue. Edit the record instead.')
  const [[row]] = await conn.query<Row[]>(`SELECT * FROM ${def.table} WHERE id = ? FOR UPDATE`, [conflict.entity_id])
  if (!row) throw new WorkflowError(`${def.label} not found.`)
  if (row.publication_status === 'published') throw new WorkflowError('Unpublish this record before changing it, then resolve the conflict.')

  // Rebuild the full edit form from the stored row, swap in the proposed value, and validate it as an edit.
  const form = new FormData()
  for (const f of def.fields) {
    const value = f.column === field.column ? conflict.proposed_value : row[f.column]
    if (f.kind === 'checkbox') {
      if (Number(value) === 1 || value === true || value === 'on') form.set(f.name, 'on')
    } else if (value != null) form.set(f.name, f.kind === 'date' ? dateText(value) : String(value))
  }
  const parentId = def.parent ? Number(row[def.parent.column]) : null
  const parsed = parseEntityForm(entity, form, parentId)
  if (!parsed.ok) throw new WorkflowError('The proposed value is not valid for this field.', parsed.fieldErrors)

  await conn.query(`UPDATE ${def.table} SET ? WHERE id = ?`, [
    {
      [field.column]: parsed.row[field.column],
      verification_status: 'unverified',
      verified_at: null,
      verified_by: null,
      publication_status: row.publication_status === 'in_review' ? 'draft' : row.publication_status,
      ...(entity === 'university' ? { provisional_listing: 0, identity_city_confirmed: 0 } : {}),
    },
    row.id,
  ])
  if (conflict.proposed_source_id != null) {
    await conn.query(
      `INSERT INTO field_sources (entity_type, entity_id, field_name, source_id, accessed_on, status, method, discrepancy_notes)
       VALUES (?, ?, ?, ?, ?, 'pending', 'official_page', ?)
       ON DUPLICATE KEY UPDATE source_id = VALUES(source_id), accessed_on = VALUES(accessed_on), status = 'pending', verified_at = NULL, verified_by = NULL, discrepancy_notes = VALUES(discrepancy_notes)`,
      [entity, row.id, field.column, conflict.proposed_source_id, todayIso(), `Accepted from conflict #${conflict.id}: ${reason}`.slice(0, 5000)],
    )
  }
  const after = await readRow(conn, def.table, Number(row.id))
  await appendChangeLog(conn, { entityType: def.logType, entityId: Number(row.id), action: 'update', actorId: actor.userId, actorRole: actor.role, reason: `Conflict #${conflict.id}: ${reason}`, before: row, after })
}

// ---------------------------------------------------------------------------------------------
// Bulk verification (Owner)
// ---------------------------------------------------------------------------------------------

export interface BulkResult {
  id: number
  ok: boolean
  message: string
}

export const BULK_VERIFY_LIMIT = 100

/**
 * Verifies each selected record with its own recorded source, one record per transaction, through the
 * normal verify step (same checks, same audit entry). A record without a source, or that fails a
 * check, is reported and left unchanged. Publishing stays a separate step.
 */
export async function bulkVerify(db: Pool, actor: AdminActor, entity: EntityKey, ids: number[], form: FormData): Promise<BulkResult[]> {
  assertCan(actor, 'data.bulk_verify')
  const unique = [...new Set(ids)]
  if (!unique.length) throw new WorkflowError('Select at least one record.')
  if (unique.length > BULK_VERIFY_LIMIT) throw new WorkflowError(`Select at most ${BULK_VERIFY_LIMIT} records at a time.`)
  const checkedAt = formText(form, 'checkedAt')
  const reviewDueAt = formText(form, 'reviewDueAt')
  const notes = formText(form, 'notes')
  const def = ENTITIES[entity]
  const results: BulkResult[] = []
  for (const id of unique) {
    const [[row]] = await db.query<Row[]>(`SELECT source_id FROM ${def.table} WHERE id = ?`, [id])
    if (!row) {
      results.push({ id, ok: false, message: 'Not found.' })
      continue
    }
    if (row.source_id == null) {
      results.push({ id, ok: false, message: 'No source recorded. Add the source before verifying.' })
      continue
    }
    const f = new FormData()
    f.set('verificationStatus', 'verified')
    f.set('sourceId', String(row.source_id))
    f.set('checkedAt', checkedAt)
    f.set('reviewDueAt', reviewDueAt)
    f.set('notes', notes ? `Bulk verification: ${notes}` : 'Bulk verification')
    try {
      await transitionRecord(db, actor, entity, id, 'verify', f)
      results.push({ id, ok: true, message: 'Verified.' })
    } catch (error) {
      if (!(error instanceof WorkflowError)) throw error
      const detail = error.blockers[0] ?? Object.values(error.fieldErrors).flat()[0]
      results.push({ id, ok: false, message: detail ? `${error.message} ${detail}` : error.message })
    }
  }
  return results
}

// ---------------------------------------------------------------------------------------------
// Academic years (Owner)
// ---------------------------------------------------------------------------------------------

export const academicYearInput = z
  .object({
    code: academicYear.refine((v) => v.includes('-'), 'Use the full form, e.g. 2026-2027.'),
    startsOn: isoDate,
    endsOn: isoDate,
    isCurrent: z.boolean(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((y) => y.endsOn > y.startsOn, { path: ['endsOn'], message: 'The end date must be after the start date.' })

export async function saveAcademicYear(db: Pool, actor: AdminActor, form: FormData): Promise<void> {
  assertCan(actor, 'data.years')
  const parsed = academicYearInput.safeParse({
    code: formText(form, 'code'),
    startsOn: formText(form, 'startsOn'),
    endsOn: formText(form, 'endsOn'),
    isCurrent: form.get('isCurrent') === 'on',
    notes: formText(form, 'notes') || undefined,
  })
  if (!parsed.success) throw new WorkflowError('Check the highlighted fields.', { ...z.flattenError(parsed.error).fieldErrors } as FieldErrors)
  const y = parsed.data
  await inTransaction(db, async (conn) => {
    const [[before]] = await conn.query<Row[]>('SELECT * FROM academic_years WHERE code = ? FOR UPDATE', [y.code])
    if (y.isCurrent) await conn.query('UPDATE academic_years SET is_current = 0 WHERE is_current = 1 AND code <> ?', [y.code])
    await conn.query(
      `INSERT INTO academic_years (code, starts_on, ends_on, is_current, notes) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE starts_on = VALUES(starts_on), ends_on = VALUES(ends_on), is_current = VALUES(is_current), notes = VALUES(notes)`,
      [y.code, y.startsOn, y.endsOn, y.isCurrent ? 1 : 0, y.notes ?? null],
    )
    const [[after]] = await conn.query<Row[]>('SELECT * FROM academic_years WHERE code = ?', [y.code])
    // The log's entity id is numeric: the starting year identifies the academic year.
    await appendChangeLog(conn, { entityType: 'academic_year', entityId: Number(y.code.slice(0, 4)), action: before ? 'update' : 'create', actorId: actor.userId, actorRole: actor.role, reason: null, before: before ?? null, after })
  })
}

// ---------------------------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------------------------

export const IMPORT_FORMAT = 'lockin-import@1'
// Server actions accept bodies up to 1 MB by default (Next.js), so files stay below that.
export const IMPORT_MAX_BYTES = 900 * 1024

const importSource = z.object({
  url: httpsUrl,
  title: z.string().trim().min(1).max(300),
  publisher: z.string().trim().min(1).max(200),
  sourceType: z.enum(SOURCE_TYPES),
  accessedOn: isoDate.optional(),
})
type ImportSource = z.infer<typeof importSource>

const looseItems = z.array(z.record(z.string(), z.unknown()))
const importFile = z.object({
  format: z.literal(IMPORT_FORMAT, { error: `The file must declare "format": "${IMPORT_FORMAT}".` }),
  universities: looseItems.min(1, 'The file lists no universities.').max(500, 'At most 500 universities per file.'),
})

export function slugify(name: string): string {
  return normaliseName(name).replace(/ /g, '-').slice(0, 120).replace(/-+$/, '')
}

interface PlannedFee { data: Record<string, unknown>; source?: ImportSource }
interface PlannedIntake { data: Record<string, unknown>; source?: ImportSource }
interface PlannedCourse { data: Record<string, unknown>; source?: ImportSource; intakes: PlannedIntake[]; fees: PlannedFee[] }
interface PlannedUniversity { data: Record<string, unknown>; source: ImportSource; courses: PlannedCourse[] }

export interface ImportSummary {
  batchId: number
  universitiesCreated: number
  coursesCreated: number
  intakesCreated: number
  feesCreated: number
  matchedExisting: number
  conflicts: number
  notes: string[]
}

/** Every problem in the file, listed as blockers so the form shows them all at once. */
export class ImportValidationError extends WorkflowError {
  constructor(problems: string[]) {
    super(`The file has ${problems.length} problem${problems.length === 1 ? '' : 's'}. Nothing was imported.`, {}, problems)
    this.name = 'ImportValidationError'
  }
}

/** Validates the whole file with the same schemas as the capture forms. Writes nothing. */
export function planImport(text: string, managedYears: Set<string>): PlannedUniversity[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ImportValidationError(['The file is not valid JSON.'])
  }
  const file = importFile.safeParse(json)
  if (!file.success) throw new ImportValidationError(file.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`))

  const problems: string[] = []
  const check = <T>(path: string, result: z.ZodSafeParseResult<T>): T | null => {
    if (result.success) return result.data
    for (const i of result.error.issues) problems.push(`${path}${i.path.length ? `.${i.path.join('.')}` : ''}: ${i.message}`)
    return null
  }
  const sourceAt = (path: string, raw: unknown, required: boolean) =>
    raw === undefined && !required ? undefined : (check(`${path}.source`, importSource.safeParse(raw)) ?? undefined)
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])

  const planned: PlannedUniversity[] = []
  const slugs = new Set<string>()
  file.data.universities.forEach((u, ui) => {
    const p = `universities[${ui}]`
    const name = typeof u.name === 'string' ? u.name : ''
    const data = check(p, universityInput.safeParse({ ...u, slug: u.slug ?? slugify(name), source: undefined, courses: undefined }))
    const source = sourceAt(p, u.source, true)
    if (data) {
      const key = `${data.destinationIso2}/${data.slug}`
      if (slugs.has(key)) problems.push(`${p}: the file lists ${key} twice.`)
      slugs.add(key)
    }
    const courses: PlannedCourse[] = []
    const courseSlugs = new Set<string>()
    list(u.courses).forEach((c, ci) => {
      const cp = `${p}.courses[${ci}]`
      const cName = typeof c.name === 'string' ? c.name : ''
      const cData = check(cp, courseInput.safeParse({ ...c, slug: c.slug ?? slugify(cName), universityId: 1 }))
      if (cData) {
        if (courseSlugs.has(cData.slug)) problems.push(`${cp}: the file lists the course ${cData.slug} twice for this university.`)
        courseSlugs.add(cData.slug)
      }
      const cSource = sourceAt(cp, c.source, false)
      const intakes = list(c.intakes).flatMap((i, ii) => {
        const d = check(`${cp}.intakes[${ii}]`, intakeInput.safeParse({ ...i, courseId: 1 }))
        return d ? [{ data: d as Record<string, unknown>, source: sourceAt(`${cp}.intakes[${ii}]`, i.source, false) }] : []
      })
      const fees = list(c.fees).flatMap((f, fi) => {
        const fp = `${cp}.fees[${fi}]`
        // Imports are drafts: the verification status is never taken from the file.
        const d = check(fp, tuitionFeeInput.safeParse({ ...f, amount: f.amount == null ? null : String(f.amount), verificationStatus: 'unverified', courseId: 1 }))
        if (d?.academicYear && managedYears.size && !managedYears.has(d.academicYear))
          problems.push(`${fp}.academicYear: ${d.academicYear} is not in the academic-year list. Add it in Settings first.`)
        return d ? [{ data: d as Record<string, unknown>, source: sourceAt(fp, f.source, false) }] : []
      })
      if (cData) courses.push({ data: cData as Record<string, unknown>, source: cSource, intakes, fees })
    })
    if (data && source) planned.push({ data: data as Record<string, unknown>, source, courses })
  })
  if (problems.length) throw new ImportValidationError(problems.slice(0, 200))
  return planned
}

function columnsFor(entity: EntityKey, data: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const f of ENTITIES[entity].fields) {
    if (f.kind === 'source') continue
    const v = data[f.name]
    if (v !== undefined) row[f.column] = typeof v === 'boolean' ? (v ? 1 : 0) : v
  }
  return row
}

async function sourceId(conn: PoolConnection, actor: AdminActor, s: ImportSource, cache: Map<string, number>): Promise<number> {
  const cached = cache.get(s.url)
  if (cached) return cached
  const [[found]] = await conn.query<Row[]>('SELECT id FROM sources WHERE url_sha256 = SHA2(?, 256)', [s.url])
  let id = found ? Number(found.id) : 0
  if (!id) {
    const [res] = await conn.query<ResultSetHeader>('INSERT INTO sources SET ?', [
      { url: s.url, title: s.title, publisher: s.publisher, source_type: s.sourceType, retrieved_at: s.accessedOn ?? todayIso(), notes: 'Added by bulk import', added_by: actor.userId },
    ])
    id = res.insertId
    const after = await readRow(conn, 'sources', id)
    await appendChangeLog(conn, { entityType: 'source', entityId: id, action: 'create', actorId: actor.userId, actorRole: actor.role, reason: 'Bulk import', before: null, after })
  }
  cache.set(s.url, id)
  return id
}

async function createDraft(conn: PoolConnection, actor: AdminActor, entity: EntityKey, row: Record<string, unknown>): Promise<number> {
  const def = ENTITIES[entity]
  // Imported records always start as draft/unverified, whatever the file contains.
  const [res] = await conn.query<ResultSetHeader>(`INSERT INTO ${def.table} SET ?`, [{ ...row, publication_status: 'draft', verification_status: 'unverified' }])
  const after = await readRow(conn, def.table, res.insertId)
  await appendChangeLog(conn, { entityType: def.logType, entityId: res.insertId, action: 'create', actorId: actor.userId, actorRole: actor.role, reason: 'Bulk import', before: null, after })
  return res.insertId
}

const COMPARED: Record<'university' | 'course', string[]> = {
  university: ['name', 'official_website', 'admissions_url', 'city', 'sub_region', 'institution_type', 'institution_subtype'],
  course: ['name', 'qualification', 'study_level', 'duration_months', 'study_mode', 'teaching_language', 'entry_requirements', 'language_requirements', 'other_language_requirements', 'course_url'],
}

/** Records one conflict per field where the file disagrees with an existing record. Never overwrites. */
async function compareExisting(conn: PoolConnection, actor: AdminActor, entity: 'university' | 'course', existing: Row, proposed: Record<string, unknown>, proposedSource: number, batchId: number, how: string): Promise<number> {
  let n = 0
  for (const column of COMPARED[entity]) {
    const next = proposed[column]
    if (next == null || (column === 'institution_type' && next === 'unknown')) continue
    const current = existing[column]
    if (current != null && String(current) === String(next)) continue
    await insertConflict(conn, actor, {
      kind: 'field_value', entity_type: entity, entity_id: existing.id, field_name: column,
      current_value: current == null ? null : String(current), proposed_value: String(next), proposed_source_id: proposedSource, import_batch_id: batchId,
      detail: `Bulk import: matched an existing ${entity} by ${how}.`,
    })
    n++
  }
  return n
}

/**
 * Imports universities (with optional courses, intakes and fees) as draft, unverified records in one
 * transaction. Existing records are never changed: a university matched by slug, name or website, or a
 * course matched by slug, gets one conflict per differing field instead. Re-importing a file is refused.
 */
export async function importRecords(db: Pool, actor: AdminActor, fileName: string, text: string): Promise<ImportSummary> {
  assertCan(actor, 'data.capture')
  if (Buffer.byteLength(text) > IMPORT_MAX_BYTES) throw new WorkflowError('The file is larger than 900 KB. Split it into smaller files.')
  const sha = createHash('sha256').update(text).digest('hex')
  const [years] = await db.query<Row[]>('SELECT code FROM academic_years')
  const plan = planImport(text, new Set(years.map((y) => String(y.code))))

  return inTransaction(db, async (conn) => {
    const [[already]] = await conn.query<Row[]>('SELECT id FROM import_batches WHERE file_sha256 = ?', [sha])
    if (already) throw new WorkflowError(`This exact file was already imported (batch #${already.id}). Nothing was imported.`)
    const total = plan.length
    const [batch] = await conn.query<ResultSetHeader>('INSERT INTO import_batches SET ?', [
      { file_name: fileName.slice(0, 255) || 'import.json', file_sha256: sha, rows_total: total, created_count: 0, duplicate_count: 0, conflict_count: 0, imported_by: actor.userId },
    ])
    const batchId = batch.insertId
    const summary: ImportSummary = { batchId, universitiesCreated: 0, coursesCreated: 0, intakesCreated: 0, feesCreated: 0, matchedExisting: 0, conflicts: 0, notes: [] }
    const sources = new Map<string, number>()
    const [all] = await conn.query<Row[]>('SELECT * FROM universities FOR UPDATE')

    for (const u of plan) {
      const uSource = await sourceId(conn, actor, u.source, sources)
      const row = columnsFor('university', u.data)
      const host = websiteHost(row.official_website as string | undefined)
      const sameDest = all.filter((x) => x.destination_iso2 === row.destination_iso2)
      const bySlug = sameDest.find((x) => x.slug === row.slug)
      const byName = bySlug ? undefined : sameDest.find((x) => normaliseName(String(x.name)) === normaliseName(String(row.name)))
      const byHost = bySlug || byName || !host ? undefined : sameDest.find((x) => websiteHost(x.official_website as string | null) === host)
      const existing = bySlug ?? byName ?? byHost
      let universityId: number
      if (existing) {
        summary.matchedExisting++
        summary.conflicts += await compareExisting(conn, actor, 'university', existing, row, uSource, batchId, bySlug ? 'slug' : byName ? 'name' : 'website')
        universityId = Number(existing.id)
      } else {
        universityId = await createDraft(conn, actor, 'university', { ...row, source_id: uSource })
        summary.universitiesCreated++
        // Later entries in the same file are matched (and compared) against the full stored row.
        all.push(await readRow(conn, 'universities', universityId))
      }

      for (const c of u.courses) {
        const cRow = columnsFor('course', c.data)
        const cSource = c.source ? await sourceId(conn, actor, c.source, sources) : uSource
        const [[existingCourse]] = await conn.query<Row[]>('SELECT * FROM courses WHERE university_id = ? AND slug = ? FOR UPDATE', [universityId, cRow.slug])
        if (existingCourse) {
          summary.conflicts += await compareExisting(conn, actor, 'course', existingCourse, cRow, cSource, batchId, 'slug')
          if (c.intakes.length || c.fees.length)
            summary.notes.push(`${String(u.data.name)} — ${String(c.data.name)}: course already exists, so its intakes and fees in the file were not imported. Add them on the course page.`)
          continue
        }
        const courseId = await createDraft(conn, actor, 'course', { ...cRow, university_id: universityId, source_id: cSource })
        summary.coursesCreated++
        for (const i of c.intakes) {
          await createDraft(conn, actor, 'course_intake', { ...columnsFor('course_intake', i.data), course_id: courseId, source_id: i.source ? await sourceId(conn, actor, i.source, sources) : cSource })
          summary.intakesCreated++
        }
        for (const f of c.fees) {
          await createDraft(conn, actor, 'tuition_fee', { ...columnsFor('tuition_fee', f.data), course_id: courseId, source_id: f.source ? await sourceId(conn, actor, f.source, sources) : cSource })
          summary.feesCreated++
        }
      }
    }

    const created = summary.universitiesCreated + summary.coursesCreated + summary.intakesCreated + summary.feesCreated
    await conn.query('UPDATE import_batches SET created_count = ?, duplicate_count = ?, conflict_count = ? WHERE id = ?', [created, summary.matchedExisting, summary.conflicts, batchId])
    const after = await readRow(conn, 'import_batches', batchId)
    await appendChangeLog(conn, { entityType: 'import_batch', entityId: batchId, action: 'import', actorId: actor.userId, actorRole: actor.role, reason: `Imported ${fileName}`.slice(0, 500), before: null, after })
    return summary
  })
}

// ---------------------------------------------------------------------------------------------
// Reads for the admin pages
// ---------------------------------------------------------------------------------------------

export async function listConflicts(db: Pool, status: 'open' | 'resolved', limit = 200): Promise<Row[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT c.*, s.url AS proposed_source_url, s.title AS proposed_source_title,
            u1.name AS entity_name, u2.name AS other_name
       FROM data_conflicts c
       LEFT JOIN sources s ON s.id = c.proposed_source_id
       LEFT JOIN universities u1 ON c.entity_type = 'university' AND u1.id = c.entity_id
       LEFT JOIN universities u2 ON c.entity_type = 'university' AND u2.id = c.other_entity_id
      WHERE ${status === 'open' ? "c.status = 'open'" : "c.status <> 'open'"}
      ORDER BY c.id ${status === 'open' ? 'ASC' : 'DESC'} LIMIT ?`,
    [limit],
  )
  return rows
}

export async function listImportBatches(db: Pool, limit = 50): Promise<Row[]> {
  const [rows] = await db.query<Row[]>('SELECT * FROM import_batches ORDER BY id DESC LIMIT ?', [limit])
  return rows
}

export async function listAcademicYears(db: Pool): Promise<Row[]> {
  const [rows] = await db.query<Row[]>('SELECT * FROM academic_years ORDER BY code DESC')
  return rows
}

/** In-review records of one type with their source, for the bulk-verification page. */
export async function listInReview(db: Pool, entity: EntityKey, limit = BULK_VERIFY_LIMIT): Promise<Row[]> {
  const def = ENTITIES[entity]
  const label = entity === 'university' || entity === 'course' || entity === 'campus' ? 'r.name' : `CONCAT('${def.label} #', r.id)`
  const [rows] = await db.query<Row[]>(
    `SELECT r.id, ${label} AS label, r.source_id, s.url AS source_url, s.title AS source_title, s.source_type
       FROM ${def.table} r LEFT JOIN sources s ON s.id = r.source_id
      WHERE r.publication_status = 'in_review' ORDER BY r.id LIMIT ?`,
    [limit],
  )
  return rows
}
