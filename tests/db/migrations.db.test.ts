// Runs the real migrations against a throwaway MySQL 8.4 server (mysql-memory-server).
// Needs libaio + libnuma on Linux. Run with `pnpm test:db`.
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { fetchDestinationDirectory } from '@/lib/db/directory-queries'
import { todayIso } from '@/lib/data/publication'
import * as T from '@/lib/data/types'
import { DESTINATIONS } from '@/lib/destinations'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'

let server: TestDatabase
let db: Connection

const TODAY = todayIso()
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const FUTURE = addDays(180)
const PAST = addDays(-1)

const VERIFIED = (sourceId: number) => ({
  publication_status: 'published',
  verification_status: 'verified',
  source_id: sourceId,
  checked_at: TODAY,
  verified_at: `${TODAY} 09:00:00`,
  verified_by: 'test-admin',
  review_due_at: FUTURE,
})

async function insert(table: string, row: Record<string, unknown>): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(`INSERT INTO ${table} SET ?`, [row])
  return res.insertId
}
async function rows<R = RowDataPacket>(sql: string, params: unknown[] = []): Promise<R[]> {
  const [r] = await db.query<RowDataPacket[]>(sql, params)
  return r as R[]
}
// MySQL: "Check constraint 'x' is violated."  MariaDB: "CONSTRAINT `x` failed for …"
const checkViolation = /check constraint|CONSTRAINT `\w+` failed/i

let sourceSeq = 0
async function newSource(type = 'university_official') {
  sourceSeq += 1
  return insert('sources', { url: `https://uni.example/fees/${sourceSeq}`, title: 'Fees page', publisher: 'Example University', source_type: type })
}

beforeAll(async () => {
  server = await startTestDatabase()
  console.info(`[db] migrations suite running on ${server.engine}`)
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
}, 240_000)

afterAll(async () => {
  await db?.end()
  await server?.stop()
})

describe('migrations', () => {
  it('are idempotent', async () => {
    expect(await migrate(db, await loadMigrations())).toEqual([])
  })

  it('refuse to run when an applied migration has been edited', async () => {
    const [first] = await loadMigrations()
    await expect(migrate(db, [{ ...first, checksum: 'x'.repeat(64) }])).rejects.toThrow(/modified after being applied/)
  })

  it('seed destinations that match lib/destinations.ts', async () => {
    const seeded = await rows<{ iso2: string; slug: string }>('SELECT iso2, slug FROM destinations ORDER BY iso2')
    expect(seeded.map((r) => ({ ...r }))).toEqual(
      [...DESTINATIONS].map((d) => ({ iso2: d.iso2, slug: d.slug })).sort((a, b) => a.iso2.localeCompare(b.iso2)),
    )
  })

  it('record QS with unconfirmed rights', async () => {
    const [qs] = await rows<{ rights_status: string }>("SELECT rights_status FROM ranking_providers WHERE slug = 'qs'")
    expect(qs.rights_status).toBe('not_confirmed')
  })

  it('keep TypeScript enums in sync with the schema', async () => {
    const enumOf = async (table: string, column: string) => {
      const [r] = await rows<{ COLUMN_TYPE: string }>(
        'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column],
      )
      return [...r.COLUMN_TYPE.matchAll(/'([^']+)'/g)].map((m) => m[1])
    }
    expect(await enumOf('universities', 'publication_status')).toEqual([...T.PUBLICATION_STATUSES])
    expect(await enumOf('tuition_fees', 'verification_status')).toEqual([...T.VERIFICATION_STATUSES])
    expect(await enumOf('sources', 'source_type')).toEqual([...T.SOURCE_TYPES])
    expect(await enumOf('courses', 'qualification')).toEqual([...T.QUALIFICATIONS])
    expect(await enumOf('courses', 'study_mode')).toEqual([...T.STUDY_MODES])
    expect(await enumOf('tuition_fees', 'fee_category')).toEqual([...T.FEE_CATEGORIES])
    expect(await enumOf('tuition_fees', 'billing_period')).toEqual([...T.BILLING_PERIODS])
    expect(await enumOf('acceptance_rates', 'applicant_scope')).toEqual([...T.APPLICANT_SCOPES])
    expect(await enumOf('ranking_providers', 'rights_status')).toEqual([...T.RIGHTS_STATUSES])
  })
})

describe('constraints', () => {
  let sourceId: number
  let uniId: number
  let courseId: number

  beforeEach(async () => {
    await db.query('DELETE FROM universities')
    sourceId = await newSource()
    uniId = await insert('universities', {
      destination_iso2: 'DE',
      slug: `uni-${sourceSeq}`,
      name: 'Example University',
      official_website: 'https://uni.example/',
      ...VERIFIED(sourceId),
    })
    courseId = await insert('courses', {
      university_id: uniId,
      slug: 'msc-example',
      name: 'MSc Example',
      qualification: 'master',
      study_level: 'PG',
      ...VERIFIED(sourceId),
    })
  })

  it('reject non-https sources and unknown destinations', async () => {
    await expect(insert('sources', { url: 'http://x.example', title: 'T', publisher: 'P', source_type: 'other' })).rejects.toThrow(checkViolation)
    await expect(insert('universities', { destination_iso2: 'FR', slug: 'x', name: 'X' })).rejects.toThrow(/foreign key/i)
    await expect(insert('universities', { destination_iso2: 'de', slug: 'x', name: 'X' })).rejects.toThrow()
  })

  it('reject publishing an unverified university', async () => {
    await expect(
      insert('universities', { destination_iso2: 'DE', slug: 'draft-uni', name: 'Draft', official_website: 'https://d.example/', publication_status: 'published' }),
    ).rejects.toThrow(checkViolation)
  })

  it('reject marking a record verified without source, date or verifier', async () => {
    await expect(
      insert('universities', { destination_iso2: 'DE', slug: 'no-src', name: 'No source', verification_status: 'verified', checked_at: TODAY }),
    ).rejects.toThrow(checkViolation)
  })

  it('reject undated, non-positive and lowercase-currency fees', async () => {
    const fee = { course_id: courseId, currency: 'EUR', billing_period: 'per_year', amount: '1500.00', ...VERIFIED(sourceId) }
    await expect(insert('tuition_fees', fee)).rejects.toThrow(checkViolation)
    await expect(insert('tuition_fees', { ...fee, academic_year: '2026-2027', amount: '0' })).rejects.toThrow(checkViolation)
    await expect(insert('tuition_fees', { ...fee, academic_year: '2026-2027', currency: 'eur' })).rejects.toThrow(checkViolation)
    expect(await insert('tuition_fees', { ...fee, academic_year: '2026-2027' })).toBeGreaterThan(0)
  })

  it('require an empty amount for unavailable fees and a definition for acceptance rates', async () => {
    const base = { course_id: courseId, currency: 'EUR', billing_period: 'per_year', ...VERIFIED(sourceId), verification_status: 'unavailable' }
    await expect(insert('tuition_fees', { ...base, amount: '100' })).rejects.toThrow(checkViolation)
    expect(await insert('tuition_fees', { ...base, amount: null })).toBeGreaterThan(0)
    await expect(
      insert('acceptance_rates', { university_id: uniId, rate_percent: '40', definition: 'short', applicant_scope: 'all', cohort_label: '2025', ...VERIFIED(sourceId) }),
    ).rejects.toThrow(checkViolation)
  })

  it('reject a level/qualification mismatch', async () => {
    await expect(
      insert('courses', { university_id: uniId, slug: 'bad', name: 'Bad', qualification: 'doctorate', study_level: 'UG' }),
    ).rejects.toThrow(checkViolation)
  })

  it('block deleting a source that facts still cite', async () => {
    await expect(db.query('DELETE FROM sources WHERE id = ?', [sourceId])).rejects.toThrow(/foreign key|sources is append-only/i)
  })

  it('require licence evidence before a provider is marked licensed', async () => {
    await expect(db.query("UPDATE ranking_providers SET rights_status = 'licensed' WHERE slug = 'qs'")).rejects.toThrow(checkViolation)
  })
})

describe('public views', () => {
  let sourceId: number
  let uniId: number
  let courseId: number
  let qsId: number

  beforeEach(async () => {
    await db.query('DELETE FROM universities')
    await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed', licence_reference = NULL, licence_scope = NULL, licence_expires_at = NULL, rights_checked_at = NULL WHERE slug = 'qs'")
    sourceId = await newSource()
    ;[{ id: qsId }] = await rows<{ id: number }>("SELECT id FROM ranking_providers WHERE slug = 'qs'")
    uniId = await insert('universities', {
      destination_iso2: 'AE',
      slug: `uni-${sourceSeq}`,
      name: 'Example University Dubai',
      official_website: 'https://uni.example/',
      city: 'Dubai',
      sub_region: 'Dubai',
      ...VERIFIED(sourceId),
    })
    courseId = await insert('courses', {
      university_id: uniId,
      slug: 'bsc-example',
      name: 'BSc Example',
      qualification: 'bachelor',
      study_level: 'UG',
      duration_months: 36,
      ...VERIFIED(sourceId),
    })
  })

  const publicFeeIds = async () => (await rows<{ id: number }>('SELECT id FROM public_tuition_fees')).map((r) => r.id)

  it('hide expired fees and fees past their validity', async () => {
    const fee = { course_id: courseId, currency: 'AED', billing_period: 'per_year', amount: '50000.00', academic_year: '2026-2027' }
    const current = await insert('tuition_fees', { ...fee, ...VERIFIED(sourceId) })
    const stale = await insert('tuition_fees', { ...fee, ...VERIFIED(sourceId), review_due_at: PAST })
    const ended = await insert('tuition_fees', { ...fee, ...VERIFIED(sourceId), valid_to: PAST })
    const draft = await insert('tuition_fees', { ...fee, ...VERIFIED(sourceId), publication_status: 'draft' })
    const ids = await publicFeeIds()
    expect(ids).toContain(current)
    expect(ids).not.toContain(stale)
    expect(ids).not.toContain(ended)
    expect(ids).not.toContain(draft)
  })

  it('hide every child when the parent university is unpublished', async () => {
    await insert('tuition_fees', { course_id: courseId, currency: 'AED', billing_period: 'per_year', amount: '1.00', academic_year: '2026', ...VERIFIED(sourceId) })
    expect(await publicFeeIds()).toHaveLength(1)
    await db.query("UPDATE universities SET publication_status = 'unpublished', unpublished_reason = 'test' WHERE id = ?", [uniId])
    expect(await publicFeeIds()).toHaveLength(0)
    expect(await rows('SELECT id FROM public_courses')).toHaveLength(0)
  })

  it('withhold verified QS rankings until rights are licensed, and again after expiry', async () => {
    const rankingSource = await newSource('ranking_provider')
    await insert('university_rankings', { university_id: uniId, provider_id: qsId, ranking_year: 2026, rank_position: 250, ...VERIFIED(rankingSource) })
    const visible = async () => (await rows('SELECT id FROM public_university_rankings')).length

    expect(await visible()).toBe(0)
    await db.query("UPDATE ranking_providers SET rights_status = 'requested' WHERE id = ?", [qsId])
    expect(await visible()).toBe(0)
    await db.query(
      "UPDATE ranking_providers SET rights_status = 'licensed', licence_reference = 'TEST', licence_scope = 'test', rights_checked_at = ? WHERE id = ?",
      [TODAY, qsId],
    )
    expect(await visible()).toBe(1)
    await db.query('UPDATE ranking_providers SET licence_expires_at = ? WHERE id = ?', [PAST, qsId])
    expect(await visible()).toBe(0)
  })

  it('assemble the destination directory from views only, with INR conversion metadata', async () => {
    await insert('tuition_fees', { course_id: courseId, currency: 'AED', billing_period: 'per_year', amount: '50000.00', academic_year: '2026-2027', ...VERIFIED(sourceId) })
    await insert('tuition_fees', { course_id: courseId, currency: 'AED', billing_period: 'per_year', amount: null, fee_category: 'domestic', ...VERIFIED(sourceId), verification_status: 'unavailable' })
    const fxSource = await newSource('exchange_rate_provider')
    // Stage 3: a rate is only usable once its provider's terms are approved (public_fx_rates).
    const providerId = await insert('fx_providers', {
      slug: `test-fx-${sourceSeq}`,
      name: 'Synthetic FX provider',
      website: 'https://fx.example/',
      terms_url: 'https://fx.example/terms',
      terms_status: 'approved',
      currencies_covered: 'AED',
      attribution_text: 'Synthetic test rates',
      update_frequency: 'daily',
      terms_checked_at: TODAY,
      terms_reviewed_by: 'test-admin',
    })
    await insert('fx_rates', { base_currency: 'AED', quote_currency: 'INR', rate: '23.0000000000', rate_date: TODAY, source_id: fxSource, provider_id: providerId })
    await insert('university_rankings', { university_id: uniId, provider_id: qsId, ranking_year: 2026, rank_position: 1, ...VERIFIED(sourceId) })

    const dir = await fetchDestinationDirectory(db, 'AE', TODAY)
    expect(dir).toHaveLength(1)
    const [uni] = dir
    expect(uni.subRegion).toBe('Dubai')
    expect(uni.rankings).toEqual([])
    const [course] = uni.courses
    expect(course.durationMonths).toBe(36)
    const intl = course.fees.find((f) => f.category === 'international')!
    expect(intl.amount).toBe('50000.00')
    expect(intl.inr).toMatchObject({
      amountInr: 1_150_000,
      rateDate: TODAY,
      providerName: 'Synthetic FX provider',
      attributionText: 'Synthetic test rates',
    })
    expect(intl.source.checkedAt).toBe(TODAY)
    const domestic = course.fees.find((f) => f.category === 'domestic')!
    expect(domestic).toMatchObject({ amount: null, status: 'unavailable', inr: null })

    expect(await fetchDestinationDirectory(db, 'DE', TODAY)).toEqual([])
  })
})
