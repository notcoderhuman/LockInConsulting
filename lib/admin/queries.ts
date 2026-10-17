import type { Pool, RowDataPacket } from 'mysql2/promise'
import { todayIso } from '@/lib/data/publication'
import { verifyAuditChain, type ChainVerification } from './audit'
import { recordTitle } from './describe'
import { ENTITIES, ENTITY_KEYS, type EntityKey } from './entities'
import { getPublishReadiness, type PublishReadiness } from './workflow'

// Read side of the dashboard. Admin reads use base tables (they must see drafts); the public
// site never does. Every value is passed as a parameter; table names come from ENTITIES only.

type Db = Pick<Pool, 'query'>
export type Row = RowDataPacket & Record<string, unknown>

async function select(db: Db, sql: string, params: unknown[] = []): Promise<Row[]> {
  const [rows] = await db.query<Row[]>(sql, params)
  return rows
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export const REVIEW_HORIZON_DAYS = 30

/** Display names for actor/verifier ids. CLI actors (`cli:…`) are shown as-is. */
export async function getUserNames(db: Db, ids: Iterable<unknown>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((v): v is string => typeof v === 'string' && v.length > 0))]
  const map = new Map<string, string>()
  const lookup = unique.filter((id) => !id.startsWith('cli:'))
  for (const id of unique) if (id.startsWith('cli:')) map.set(id, `${id.slice(4)} (command line)`)
  if (lookup.length) {
    for (const u of await select(db, 'SELECT id, name, email FROM auth_user WHERE id IN (?)', [lookup]))
      map.set(String(u.id), `${u.name} <${u.email}>`)
  }
  return map
}

// ---- Overview ----

export interface StatusCounts {
  draft: number
  in_review: number
  published: number
  unpublished: number
}

export async function getStatusCounts(db: Db): Promise<Record<EntityKey, StatusCounts>> {
  const out = {} as Record<EntityKey, StatusCounts>
  for (const key of ENTITY_KEYS) {
    const counts: StatusCounts = { draft: 0, in_review: 0, published: 0, unpublished: 0 }
    for (const r of await select(db, `SELECT publication_status AS s, COUNT(*) AS n FROM ${ENTITIES[key].table} GROUP BY publication_status`))
      counts[r.s as keyof StatusCounts] = Number(r.n)
    out[key] = counts
  }
  return out
}

// ---- Review queue ----

export type QueueReason = 'in_review' | 'expired' | 'due_soon'

export interface QueueItem {
  entity: EntityKey
  id: number
  title: string
  context: string | null
  reason: QueueReason
  reviewDueAt: string | null
  validTo: string | null
  verificationStatus: string
  updatedAt: string
}

async function parentNames(db: Db, entity: EntityKey, rows: Row[]): Promise<Map<number, string>> {
  const parent = ENTITIES[entity].parent
  const map = new Map<number, string>()
  if (!parent || !rows.length) return map
  const ids = [...new Set(rows.map((r) => Number(r[parent.column])))]
  const parentDef = ENTITIES[parent.entity]
  for (const p of await select(db, `SELECT id, name FROM ${parentDef.table} WHERE id IN (?)`, [ids])) map.set(Number(p.id), String(p.name))
  return map
}

export async function getReviewQueue(db: Db, today = todayIso()): Promise<QueueItem[]> {
  const horizon = addDays(today, REVIEW_HORIZON_DAYS)
  const items: QueueItem[] = []
  for (const key of ENTITY_KEYS) {
    const def = ENTITIES[key]
    const validity = key === 'tuition_fee' ? ' OR (valid_to IS NOT NULL AND valid_to <= ?)' : ''
    const params = key === 'tuition_fee' ? [horizon, horizon] : [horizon]
    const rows = await select(
      db,
      `SELECT * FROM ${def.table}
        WHERE publication_status = 'in_review'
           OR (publication_status = 'published' AND (review_due_at IS NULL OR review_due_at <= ?${validity}))
        ORDER BY updated_at`,
      params,
    )
    const parents = await parentNames(db, key, rows)
    for (const r of rows) {
      const due = r.review_due_at == null ? null : String(r.review_due_at)
      const validTo = r.valid_to == null ? null : String(r.valid_to)
      const expired = (due != null && due < today) || (validTo != null && validTo < today) || due == null
      items.push({
        entity: key,
        id: Number(r.id),
        title: recordTitle(key, r),
        context: def.parent ? (parents.get(Number(r[def.parent.column])) ?? null) : null,
        reason: r.publication_status === 'in_review' ? 'in_review' : expired ? 'expired' : 'due_soon',
        reviewDueAt: due,
        validTo,
        verificationStatus: String(r.verification_status),
        updatedAt: String(r.updated_at),
      })
    }
  }
  const order: Record<QueueReason, number> = { expired: 0, in_review: 1, due_soon: 2 }
  return items.sort((a, b) => order[a.reason] - order[b.reason] || (a.reviewDueAt ?? '').localeCompare(b.reviewDueAt ?? ''))
}

// ---- Universities ----

export interface UniversityFilters {
  destination?: string
  status?: string
  q?: string
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function listUniversities(db: Db, filters: UniversityFilters): Promise<Row[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.destination) {
    where.push('u.destination_iso2 = ?')
    params.push(filters.destination)
  }
  if (filters.status) {
    where.push('u.publication_status = ?')
    params.push(filters.status)
  }
  if (filters.q) {
    where.push('u.name LIKE ?')
    params.push(`%${escapeLike(filters.q)}%`)
  }
  return select(
    db,
    `SELECT u.*, (SELECT COUNT(*) FROM courses c WHERE c.university_id = u.id) AS course_count
       FROM universities u ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.name LIMIT 500`,
    params,
  )
}

// ---- Record detail ----

export interface Crumb {
  entity: EntityKey
  id: number
  title: string
}

export interface RecordDetail {
  entity: EntityKey
  row: Row
  ancestors: Crumb[]
  children: { entity: EntityKey; rows: Row[] }[]
  source: Row | null
  readiness: PublishReadiness
  history: Row[]
  names: Map<string, string>
  providerName: string | null
}

export async function getRecordRow(db: Db, entity: EntityKey, id: number): Promise<Row | null> {
  const [row] = await select(db, `SELECT * FROM ${ENTITIES[entity].table} WHERE id = ?`, [id])
  return row ?? null
}

export async function getAncestors(db: Db, entity: EntityKey, row: Row): Promise<Crumb[]> {
  const crumbs: Crumb[] = []
  let def = ENTITIES[entity]
  let current: Row | null = row
  while (def.parent && current) {
    const parentKey: EntityKey = def.parent.entity
    const parent: Row | null = await getRecordRow(db, parentKey, Number(current[def.parent.column]))
    if (!parent) break
    crumbs.unshift({ entity: parentKey, id: Number(parent.id), title: recordTitle(parentKey, parent) })
    def = ENTITIES[parentKey]
    current = parent
  }
  return crumbs
}

export async function getHistory(db: Db, entityType: string, id: number): Promise<Row[]> {
  return select(db, 'SELECT * FROM data_change_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 100', [entityType, id])
}

export async function getRecordDetail(db: Db, entity: EntityKey, id: number): Promise<RecordDetail | null> {
  const def = ENTITIES[entity]
  const row = await getRecordRow(db, entity, id)
  if (!row) return null
  const [ancestors, history, readiness] = await Promise.all([
    getAncestors(db, entity, row),
    getHistory(db, def.logType, id),
    getPublishReadiness(db, entity, row),
  ])
  const children = await Promise.all(
    def.children.map(async (child) => ({
      entity: child,
      rows: await select(db, `SELECT * FROM ${ENTITIES[child].table} WHERE ${ENTITIES[child].parent!.column} = ? ORDER BY id`, [id]),
    })),
  )
  const [source] = row.source_id == null ? [] : await select(db, 'SELECT * FROM sources WHERE id = ?', [row.source_id])
  let providerName: string | null = null
  if (entity === 'university_ranking') {
    const [p] = await select(db, 'SELECT name FROM ranking_providers WHERE id = ?', [row.provider_id])
    providerName = p ? String(p.name) : null
  }
  const names = await getUserNames(db, [row.verified_by, ...history.map((h) => h.actor_id)])
  return { entity, row, ancestors, children, source: source ?? null, readiness, history, names, providerName }
}

// ---- Form options ----

export interface Option {
  value: string
  label: string
}

export async function getFormOptions(db: Db, universityId: number | null) {
  const [sources, providers, campuses, courses] = await Promise.all([
    select(db, 'SELECT id, title, publisher FROM sources ORDER BY created_at DESC LIMIT 500'),
    select(db, 'SELECT id, name, rights_status FROM ranking_providers ORDER BY name'),
    universityId ? select(db, 'SELECT id, name FROM campuses WHERE university_id = ? ORDER BY name', [universityId]) : Promise.resolve([]),
    universityId ? select(db, 'SELECT id, name FROM courses WHERE university_id = ? ORDER BY name', [universityId]) : Promise.resolve([]),
  ])
  return {
    source: sources.map((s) => ({ value: String(s.id), label: `${s.title} — ${s.publisher}` })),
    ranking_provider: providers.map((p) => ({ value: String(p.id), label: `${p.name} (rights: ${String(p.rights_status).replace(/_/g, ' ')})` })),
    campus: campuses.map((c) => ({ value: String(c.id), label: String(c.name) })),
    course: courses.map((c) => ({ value: String(c.id), label: String(c.name) })),
  } satisfies Record<string, Option[]>
}

/** The university a record belongs to (for campus/course pickers). */
export async function owningUniversityId(db: Db, entity: EntityKey, parentId: number | null, row: Row | null): Promise<number | null> {
  if (entity === 'university') return row ? Number(row.id) : null
  const def = ENTITIES[entity]
  const pid = row && def.parent ? Number(row[def.parent.column]) : parentId
  if (pid == null || !def.parent) return null
  if (def.parent.entity === 'university') return pid
  const course = await getRecordRow(db, 'course', pid)
  return course ? Number(course.university_id) : null
}

// ---- Sources ----

const CITING_TABLES: { entity: EntityKey; table: string }[] = ENTITY_KEYS.map((k) => ({ entity: k, table: ENTITIES[k].table }))

export async function listSources(db: Db, q?: string): Promise<Row[]> {
  const counts = CITING_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t.table} x WHERE x.source_id = s.id)`).join(' + ')
  const where = q ? 'WHERE s.title LIKE ? OR s.publisher LIKE ? OR s.url LIKE ?' : ''
  const like = q ? `%${escapeLike(q)}%` : null
  return select(
    db,
    `SELECT s.*, (${counts} + (SELECT COUNT(*) FROM fx_rates f WHERE f.source_id = s.id)) AS citation_count
       FROM sources s ${where} ORDER BY s.created_at DESC LIMIT 500`,
    q ? [like, like, like] : [],
  )
}

export async function getSourceDetail(db: Db, id: number) {
  const [source] = await select(db, 'SELECT * FROM sources WHERE id = ?', [id])
  if (!source) return null
  const citations: { entity: EntityKey; id: number; title: string; status: string }[] = []
  for (const t of CITING_TABLES)
    for (const r of await select(db, `SELECT * FROM ${t.table} WHERE source_id = ? ORDER BY id`, [id]))
      citations.push({ entity: t.entity, id: Number(r.id), title: recordTitle(t.entity, r), status: String(r.publication_status) })
  const history = await getHistory(db, 'source', id)
  const names = await getUserNames(db, [source.added_by, ...history.map((h) => h.actor_id)])
  return { source, citations, history, names }
}

// ---- Change log ----

export async function getChangeLog(db: Db, page: number, pageSize = 50) {
  const offset = Math.max(0, (page - 1) * pageSize)
  const [rows, [total]] = await Promise.all([
    select(db, 'SELECT * FROM data_change_log ORDER BY id DESC LIMIT ? OFFSET ?', [pageSize, offset]),
    select(db, 'SELECT COUNT(*) AS n FROM data_change_log'),
  ])
  const names = await getUserNames(db, rows.map((r) => r.actor_id))
  return { rows, total: Number(total.n), names, pageSize }
}

export async function getChainStatus(db: Db): Promise<ChainVerification> {
  return verifyAuditChain(db)
}

// ---- Settings ----

export async function getSettingsData(db: Db) {
  const [rankingProviders, fxProviders, fxRates, members, fxSources] = await Promise.all([
    select(db, 'SELECT * FROM ranking_providers ORDER BY name'),
    select(db, 'SELECT * FROM fx_providers ORDER BY name'),
    select(
      db,
      `SELECT f.*, p.name AS provider_name, p.terms_status FROM fx_rates f
         LEFT JOIN fx_providers p ON p.id = f.provider_id ORDER BY f.rate_date DESC, f.id DESC LIMIT 20`,
    ),
    select(
      db,
      `SELECT m.user_id, m.role, m.status, m.granted_by, m.granted_at, m.revoked_at, u.name, u.email
         FROM admin_members m JOIN auth_user u ON u.id = m.user_id ORDER BY m.status, u.name`,
    ),
    select(db, "SELECT id, title, publisher FROM sources WHERE source_type = 'exchange_rate_provider' ORDER BY created_at DESC"),
  ])
  const names = await getUserNames(db, [
    ...fxProviders.map((p) => p.terms_reviewed_by),
    ...members.map((m) => m.granted_by),
    ...fxRates.map((r) => r.entered_by),
  ])
  return { rankingProviders, fxProviders, fxRates, members, fxSources, names }
}
