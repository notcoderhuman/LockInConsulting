import type { Pool, PoolConnection, Connection, RowDataPacket } from 'mysql2/promise'
import { convertToInr, type StoredFxRate } from '@/lib/data/money'
import type {
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

export async function fetchDestinationDirectory(
  db: Queryable,
  iso2: string,
  today: IsoDate,
): Promise<PublicUniversity[]> {
  const universities = await select(
    db,
    'SELECT * FROM public_universities WHERE destination_iso2 = ? ORDER BY name',
    [iso2],
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
