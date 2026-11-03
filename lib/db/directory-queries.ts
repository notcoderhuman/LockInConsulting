import type { Pool, PoolConnection, Connection, RowDataPacket } from 'mysql2/promise'
import { convertToInr, type StoredFxRate } from '@/lib/data/money'
import type {
  DirectoryEntry,
  IsoDate,
  PublicAcceptanceRate,
  PublicCourse,
  PublicIntake,
  PublicRanking,
  PublicTuitionFee,
  PublicUniversity,
  SourceRef,
} from '@/lib/data/types'

export type Queryable = Pick<Pool | PoolConnection | Connection, 'query'>

// Reads only the public_* views — never the base tables — so every publication rule in the
// migration applies. Requires a connection created with `dateStrings: true`.

type Row = RowDataPacket & Record<string, unknown>

async function select(db: Queryable, sql: string, params: unknown[]): Promise<Row[]> {
  const [rows] = await db.query<Row[]>(sql, params)
  return rows
}

function str(v: unknown): string {
  return String(v)
}
function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v)
}
function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v)
}

// The public page lists at most 50 universities, 5 at a time, loaded from the server.
export const DIRECTORY_PAGE_SIZE = 5
export const DIRECTORY_MAX = 50

// Order: the latest published overall QS rank or band — only when QS is licensed (the public view
// enforces that, D-014) AND the owner recorded that the licence covers ordering (allow_ordering,
// D-042) — then name, then id so pages never overlap or skip. A provisional entry has no public
// ranking, so it sorts by name; a card keeps its place when it becomes verified unless it gains a rank.
const qsRank = (alias: string) => `(SELECT COALESCE(r.rank_position, r.rank_band_low)
     FROM public_university_rankings r JOIN ranking_providers p ON p.id = r.provider_id
    WHERE r.university_id = ${alias}.id AND p.slug = 'qs' AND r.subject = '' AND r.allow_ordering = 1
    ORDER BY r.ranking_year DESC LIMIT 1)`
const order = (alias: string) => `ORDER BY qs_rank IS NULL, qs_rank, ${alias}.name, ${alias}.id`

/**
 * One page of the public directory (verified and provisional entries together, D-043), plus how many
 * entries exist in all (capped at 50) and how many of those are verified. Reads only
 * public_directory_listings / public_provisional_universities / the public_* detail views.
 */
export async function fetchDirectoryPage(
  db: Queryable,
  iso2: string,
  today: IsoDate,
  offset: number,
): Promise<{ entries: DirectoryEntry[]; total: number; verifiedTotal: number; otherTotal: number }> {
  const [count] = await select(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(listing_state = 'verified'), 0) AS verified,
            (SELECT COUNT(*) FROM public_provisional_universities p WHERE p.destination_iso2 = ? AND p.institution_category = 'other') AS other
       FROM public_directory_listings WHERE destination_iso2 = ?`,
    [iso2, iso2],
  )
  const total = Math.min(Number(count.n), DIRECTORY_MAX)
  const limit = Math.max(0, Math.min(DIRECTORY_PAGE_SIZE, total - offset))
  const verifiedTotal = Number(count.verified)
  // shortcut: past the 50 cap the split counts the whole destination, not only the 50 shown; no destination is mixed and over 50 today.
  const otherTotal = Math.min(Number(count.other), total)
  if (!limit) return { entries: [], total, verifiedTotal, otherTotal }

  const rows = await select(
    db,
    `SELECT l.id, l.listing_state, ${qsRank('l')} AS qs_rank FROM public_directory_listings l WHERE l.destination_iso2 = ? ${order('l')} LIMIT ? OFFSET ?`,
    [iso2, limit, offset],
  )
  const ids = (state: string) => rows.filter((r) => r.listing_state === state).map((r) => Number(r.id))
  const verifiedIds = ids('verified')
  const provisionalIds = ids('provisional')
  const [verified, provisional] = await Promise.all([
    verifiedIds.length ? fetchDestinationDirectory(db, iso2, today, verifiedIds) : Promise.resolve([]),
    provisionalIds.length ? select(db, 'SELECT * FROM public_provisional_universities WHERE id IN (?)', [provisionalIds]) : Promise.resolve([]),
  ])
  const byId = new Map<number, DirectoryEntry>([
    ...verified.map((u): [number, DirectoryEntry] => [u.id, { ...u, listing: 'verified' }]),
    ...provisional.map((p): [number, DirectoryEntry] => [Number(p.id), toProvisional(p)]),
  ])
  // A row that changed state between the two reads is skipped rather than shown wrongly.
  return { entries: rows.map((r) => byId.get(Number(r.id))).filter((e): e is DirectoryEntry => e !== undefined), total, verifiedTotal, otherTotal }
}

// Identity fields only — the type has no room for courses, fees, rankings or requirements.
function toProvisional(p: Row): DirectoryEntry {
  return {
    listing: 'provisional',
    id: Number(p.id),
    slug: str(p.slug),
    name: str(p.name),
    identityStatus: p.identity_status === 'checked' ? 'checked' : 'pending',
    category: p.institution_category === 'other' ? 'other' : 'university',
    officialWebsite: strOrNull(p.official_website),
    city: strOrNull(p.city),
    identityCheckedAt: strOrNull(p.identity_checked_at),
  }
}

/**
 * One listed university by destination + slug, for its profile page: the same entry the directory
 * would show (verified or provisional), read from the same public views. Not listed → null.
 */
export async function fetchUniversityProfile(db: Queryable, iso2: string, slug: string, today: IsoDate): Promise<DirectoryEntry | null> {
  const [row] = await select(db, 'SELECT id, listing_state FROM public_directory_listings WHERE destination_iso2 = ? AND slug = ? LIMIT 1', [iso2, slug])
  if (!row) return null
  const id = Number(row.id)
  if (row.listing_state === 'verified') {
    const [u] = await fetchDestinationDirectory(db, iso2, today, [id])
    return u ? { ...u, listing: 'verified' } : null
  }
  const [p] = await select(db, 'SELECT * FROM public_provisional_universities WHERE id = ?', [id])
  return p ? toProvisional(p) : null
}

/** Verified, published universities with their approved details (all of a destination, or the given ids). */
export async function fetchDestinationDirectory(
  db: Queryable,
  iso2: string,
  today: IsoDate,
  ids?: number[],
): Promise<PublicUniversity[]> {
  const universities = await select(
    db,
    `SELECT u.*, ${qsRank('u')} AS qs_rank FROM public_universities u WHERE u.destination_iso2 = ?${ids ? ' AND u.id IN (?)' : ''} ${order('u')}`,
    ids ? [iso2, ids] : [iso2],
  )
  if (universities.length === 0) return []
  const uniIds = universities.map((u) => Number(u.id))

  const courses = await select(db, 'SELECT * FROM public_courses WHERE university_id IN (?) ORDER BY name', [uniIds])
  const courseIds = courses.map((c) => Number(c.id))

  const [intakes, fees, rates, rankings] = await Promise.all([
    courseIds.length
      ? select(db, 'SELECT * FROM public_course_intakes WHERE course_id IN (?) ORDER BY intake_year, intake_month', [courseIds])
      : Promise.resolve([]),
    courseIds.length
      ? select(db, 'SELECT * FROM public_tuition_fees WHERE course_id IN (?) ORDER BY fee_category, id', [courseIds])
      : Promise.resolve([]),
    select(db, 'SELECT * FROM public_acceptance_rates WHERE university_id IN (?) ORDER BY id', [uniIds]),
    select(db, 'SELECT * FROM public_university_rankings WHERE university_id IN (?) ORDER BY ranking_year DESC, id', [uniIds]),
  ])

  const sourceIds = [
    ...new Set([universities, courses, intakes, fees, rates, rankings].flat().map((r) => Number(r.source_id))),
  ]
  const sourceRows = await select(db, 'SELECT * FROM public_sources WHERE id IN (?)', [sourceIds])
  const sources = new Map(sourceRows.map((s) => [Number(s.id), s]))
  const ref = (row: Row): SourceRef => {
    const s = sources.get(Number(row.source_id))
    if (!s) throw new Error(`Missing source ${row.source_id}`)
    return { url: str(s.url), title: str(s.title), publisher: str(s.publisher), checkedAt: str(row.checked_at) }
  }

  const currencies = [...new Set(fees.map((f) => str(f.currency)).filter((c) => c !== 'INR'))]
  const fx = new Map<string, StoredFxRate>()
  if (currencies.length) {
    const fxRows = await select(
      db,
      `SELECT f.base_currency, f.rate, f.rate_date, f.provider_name, f.attribution_text, s.title, s.url
         FROM public_fx_rates f JOIN public_sources s ON s.id = f.source_id
        WHERE f.quote_currency = 'INR' AND f.base_currency IN (?) AND f.rate_date <= ?
        ORDER BY f.rate_date DESC, f.id DESC`,
      [currencies, today],
    )
    for (const r of fxRows) {
      const base = str(r.base_currency)
      if (!fx.has(base))
        fx.set(base, {
          rate: str(r.rate),
          rateDate: str(r.rate_date),
          sourceTitle: str(r.title),
          sourceUrl: str(r.url),
          providerName: strOrNull(r.provider_name) ?? undefined,
          attributionText: strOrNull(r.attribution_text) ?? undefined,
        })
    }
  }

  const intakesByCourse = groupBy(intakes, 'course_id', (i): PublicIntake => ({
    id: Number(i.id),
    month: Number(i.intake_month),
    year: numOrNull(i.intake_year),
    applicationDeadline: strOrNull(i.application_deadline),
    source: ref(i),
  }))

  const feesByCourse = groupBy(fees, 'course_id', (f): PublicTuitionFee => {
    const amount = strOrNull(f.amount)
    const currency = str(f.currency)
    return {
      id: Number(f.id),
      category: f.fee_category as PublicTuitionFee['category'],
      amount,
      currency,
      billingPeriod: f.billing_period as PublicTuitionFee['billingPeriod'],
      academicYear: strOrNull(f.academic_year),
      validTo: strOrNull(f.valid_to),
      notes: strOrNull(f.fee_notes),
      status: f.verification_status as PublicTuitionFee['status'],
      source: ref(f),
      inr: convertToInr(amount, currency, fx.get(currency), today),
    }
  })

  const coursesByUni = groupBy(courses, 'university_id', (c): PublicCourse => ({
    id: Number(c.id),
    name: str(c.name),
    qualification: c.qualification as PublicCourse['qualification'],
    studyLevel: c.study_level as PublicCourse['studyLevel'],
    durationMonths: numOrNull(c.duration_months),
    studyMode: (c.study_mode ?? null) as PublicCourse['studyMode'],
    teachingLanguage: strOrNull(c.teaching_language),
    entryRequirements: strOrNull(c.entry_requirements),
    languageRequirements: strOrNull(c.language_requirements),
    courseUrl: strOrNull(c.course_url),
    source: ref(c),
    intakes: intakesByCourse.get(Number(c.id)) ?? [],
    fees: feesByCourse.get(Number(c.id)) ?? [],
  }))

  const ratesByUni = groupBy(rates, 'university_id', (a): PublicAcceptanceRate => ({
    id: Number(a.id),
    courseId: numOrNull(a.course_id),
    ratePercent: strOrNull(a.rate_percent),
    definition: str(a.definition),
    scope: a.applicant_scope as PublicAcceptanceRate['scope'],
    cohortLabel: str(a.cohort_label),
    status: a.verification_status as PublicAcceptanceRate['status'],
    source: ref(a),
  }))

  const rankingsByUni = groupBy(rankings, 'university_id', (r): PublicRanking => ({
    id: Number(r.id),
    providerName: str(r.provider_name),
    year: Number(r.ranking_year),
    edition: strOrNull(r.edition),
    subject: str(r.subject),
    position: numOrNull(r.rank_position),
    bandLow: numOrNull(r.rank_band_low),
    bandHigh: numOrNull(r.rank_band_high),
    attribution: strOrNull(r.attribution_text),
    aiUseAllowed: Number(r.allow_ai_use) === 1,
    source: ref(r),
  }))

  return universities.map((u) => ({
    id: Number(u.id),
    slug: str(u.slug),
    name: str(u.name),
    officialWebsite: str(u.official_website),
    city: strOrNull(u.city),
    subRegion: strOrNull(u.sub_region),
    institutionType: u.institution_type as PublicUniversity['institutionType'],
    source: ref(u),
    courses: coursesByUni.get(Number(u.id)) ?? [],
    acceptanceRates: ratesByUni.get(Number(u.id)) ?? [],
    rankings: rankingsByUni.get(Number(u.id)) ?? [],
  }))
}

function groupBy<T>(rows: Row[], key: string, map: (row: Row) => T): Map<number, T[]> {
  const out = new Map<number, T[]>()
  for (const row of rows) {
    const k = Number(row[key])
    const list = out.get(k) ?? []
    list.push(map(row))
    out.set(k, list)
  }
  return out
}
