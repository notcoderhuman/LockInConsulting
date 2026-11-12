// Derek retrieval (lib/derek/evidence.ts) against synthetic PUBLISHED directory data: universities,
// courses, intakes, tuition with its INR estimate and FX source, admissions links and comparisons.
// Drafts, unverified rows, unapproved FX rates and rankings without AI-use rights never appear.
// Synthetic data and the offline mock provider only.
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, startTestDatabase, type TestDatabase } from './harness'
import { loadMigrations, migrate } from '../../scripts/migrate.mjs'
import { todayIso } from '@/lib/data/publication'

const { loadEvidence } = await import('@/lib/derek/evidence')
const { analyseQuestion } = await import('@/lib/derek/guidance')
const { MockProvider } = await import('@/lib/derek/providers/mock')
const { DEREK_INSTRUCTIONS } = await import('@/lib/derek/provider')
const { assessDraft, assessQuestion } = await import('@/lib/derek/safeguards')

let server: TestDatabase
let db: Connection
const TODAY = todayIso()
const YEAR = Number(TODAY.slice(0, 4))
const addDays = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
let src = 0
let fxSrc = 0
let draftSrc = 0

const live = () => ({ publication_status: 'published', verification_status: 'verified', source_id: src, checked_at: TODAY, verified_at: `${TODAY} 00:00:00`, verified_by: 'u-reviewer', review_due_at: addDays(90) })
async function insert(table: string, fields: Record<string, unknown>): Promise<number> {
  const [res] = await db.query(`INSERT INTO ${table} SET ?`, [fields])
  return Number((res as { insertId: number }).insertId)
}

let alpha = 0
let beta = 0
let course = 0
const ids: Record<string, number> = {}

beforeAll(async () => {
  server = await startTestDatabase()
  console.info(`[db] derek-retrieval suite running on ${server.engine}`)
  db = await connect(server.url)
  await migrate(db, await loadMigrations())
  src = await insert('sources', { url: 'https://alpha.example/msc-data/fees', title: 'Fees page (synthetic)', publisher: 'Alpha University (synthetic)', source_type: 'university_official' })
  fxSrc = await insert('sources', { url: 'https://fx.example/eur-inr', title: 'EUR/INR reference rate (synthetic)', publisher: 'Synthetic FX', source_type: 'exchange_rate_provider' })
  const approvedFx = await insert('fx_providers', { slug: 'synthetic-fx', name: 'Synthetic FX', website: 'https://fx.example/', terms_url: 'https://fx.example/terms', terms_status: 'approved', currencies_covered: 'EUR', attribution_text: 'Rates: Synthetic FX', update_frequency: 'daily', terms_checked_at: TODAY, terms_reviewed_by: 'u-owner' })
  const unapprovedFx = await insert('fx_providers', { slug: 'unreviewed-fx', name: 'Unreviewed FX', website: 'https://fx2.example/', terms_url: 'https://fx2.example/terms' })
  await insert('fx_rates', { base_currency: 'EUR', rate: '90.0000000000', rate_date: addDays(-1), source_id: fxSrc, provider_id: approvedFx })
  await insert('fx_rates', { base_currency: 'GBP', rate: '110.0000000000', rate_date: addDays(-1), source_id: fxSrc, provider_id: unapprovedFx })

  alpha = await insert('universities', { destination_iso2: 'DE', name: 'Alpha Synthetic University', slug: 'alpha-synthetic-university', official_website: 'https://alpha.example/', city: 'Berlin', ...live() })
  beta = await insert('universities', { destination_iso2: 'GB', name: 'Beta Synthetic University', slug: 'beta-synthetic-university', official_website: 'https://beta.example/', ...live() })
  await insert('universities', { destination_iso2: 'DE', name: 'Gamma Draft University', slug: 'gamma-draft-university', official_website: 'https://gamma.example/' })

  course = await insert('courses', { university_id: alpha, slug: 'msc-data', name: 'MSc Synthetic Data', qualification: 'master', study_level: 'PG', duration_months: 24, course_url: 'https://alpha.example/msc-data', ...live() })
  await insert('courses', { university_id: alpha, slug: 'msc-hidden', name: 'MSc Hidden Draft', qualification: 'master', study_level: 'PG' })
  const betaCourse = await insert('courses', { university_id: beta, slug: 'msc-beta', name: 'MSc Beta Data', qualification: 'master', study_level: 'PG', ...live() })
  const year = `${YEAR}-${YEAR + 1}`
  ids.fee = await insert('tuition_fees', { course_id: course, currency: 'EUR', billing_period: 'per_year', amount: '15000.00', academic_year: year, ...live() })
  ids.unavailable = await insert('tuition_fees', { course_id: course, fee_category: 'eu_eea', currency: 'EUR', billing_period: 'per_year', amount: null, academic_year: year, ...live(), verification_status: 'unavailable' })
  ids.stale = await insert('tuition_fees', { course_id: course, fee_category: 'domestic', currency: 'EUR', billing_period: 'per_year', amount: '4321.00', academic_year: `${YEAR - 2}-${YEAR - 1}`, ...live() })
  await insert('tuition_fees', { course_id: course, fee_category: 'other', currency: 'EUR', billing_period: 'per_year', amount: '99999.00' }) // draft
  ids.gbp = await insert('tuition_fees', { course_id: betaCourse, currency: 'GBP', billing_period: 'per_year', amount: '28000.00', academic_year: year, ...live() })
  ids.intake = await insert('course_intakes', { course_id: course, intake_month: 10, intake_year: YEAR + 1, application_deadline: `${YEAR + 1}-05-31`, ...live() })
  ids.noDeadline = await insert('course_intakes', { course_id: course, intake_month: 4, intake_year: YEAR + 1, application_deadline: null, ...live() })

  // Draft records as the bulk import leaves them: draft/unverified, each with its own source.
  draftSrc = await insert('sources', { url: 'https://delta.example/msc', title: 'MSc page (synthetic)', publisher: 'Delta University (synthetic)', source_type: 'university_official', retrieved_at: '2026-11-01' })
  const feeSrc = await insert('sources', { url: 'https://delta.example/fees', title: 'Fees (synthetic)', publisher: 'Delta University (synthetic)', source_type: 'university_official', retrieved_at: '2026-11-02' })
  const draft = { source_id: draftSrc }
  ids.delta = await insert('universities', { destination_iso2: 'CA', name: 'Delta Draft University', slug: 'delta-draft-university', official_website: 'https://delta.example/', ...draft })
  ids.deltaCourse = await insert('courses', { university_id: ids.delta, slug: 'msc-delta', name: 'MSc Delta Analytics', qualification: 'master', study_level: 'PG', course_url: 'https://delta.example/msc', entry_requirements: 'A bachelor degree in a related subject', ...draft })
  ids.deltaFee = await insert('tuition_fees', { course_id: ids.deltaCourse, currency: 'CAD', billing_period: 'per_year', amount: '31234.00', academic_year: year, ...draft })
  await insert('field_sources', { entity_type: 'tuition_fee', entity_id: ids.deltaFee, field_name: 'amount', source_id: feeSrc, accessed_on: '2026-11-02', method: 'official_page' })
  ids.deltaIntake = await insert('course_intakes', { course_id: ids.deltaCourse, intake_month: 9, intake_year: YEAR + 1, application_deadline: `${YEAR + 1}-01-15`, ...draft })
  // A withdrawn record never returns, even with a source.
  await insert('universities', { destination_iso2: 'CA', name: 'Epsilon Withdrawn University', slug: 'epsilon-withdrawn-university', official_website: 'https://epsilon.example/', publication_status: 'unpublished', unpublished_reason: 'Synthetic: withdrawn', ...draft })
  // A published university's own draft fee (not yet checked) is offered too, labelled.
  ids.alphaDraftFee = await insert('tuition_fees', { course_id: course, fee_category: 'eu_eea', currency: 'EUR', billing_period: 'per_semester', amount: '1550.00', academic_year: year, ...draft })
}, 240_000)

afterAll(async () => {
  await db?.end()
  await server?.stop()
})

describe('Derek retrieval from published data only', () => {
  it('returns course, tuition with its INR estimate and FX source, intakes and the admissions link, each with its source', async () => {
    const evidence = await loadEvidence(db, 'What are the fees and deadlines at Alpha Synthetic University?', TODAY)
    const byRef = new Map(evidence.map((e) => [e.ref, e]))
    expect(byRef.get(`course:${course}`)?.text).toContain('course and admissions page https://alpha.example/msc-data')
    expect(byRef.get(`tuition_fee:${ids.fee}`)?.text).toContain('EUR 15000.00 per year')
    expect(byRef.get(`tuition_fee:${ids.fee}:inr`)).toMatchObject({
      text: expect.stringContaining(`approximately INR 1350000 at EUR 1 = INR 90 (rate date ${addDays(-1)})`),
      sourceUrl: 'https://fx.example/eur-inr',
      publisher: 'Synthetic FX',
      checkedAt: addDays(-1),
    })
    expect(byRef.get(`course_intake:${ids.intake}`)?.text).toContain(`application deadline ${YEAR + 1}-05-31`)
    // Every item says where it came from.
    for (const e of evidence) expect(e).toMatchObject({ sourceUrl: expect.stringMatching(/^https:\/\//), publisher: expect.any(String), checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(evidence.every((e) => e.publisher.length > 0)).toBe(true)
  })

  it('states missing and out-of-date figures as such, never with the old amount', async () => {
    const evidence = await loadEvidence(db, 'Fees at Alpha Synthetic University?', TODAY)
    const text = (ref: string) => evidence.find((e) => e.ref === ref)?.text
    expect(text(`tuition_fee:${ids.unavailable}`)).toMatch(/checked and not publicly available/)
    expect(text(`tuition_fee:${ids.stale}`)).toMatch(/academic year that has ended, so LockIn has no current fee/)
    expect(text(`course_intake:${ids.noDeadline}`)).toMatch(/application deadline not published/)
    expect(JSON.stringify(evidence)).not.toMatch(/4321|99999|Hidden Draft|Gamma/)
  })

  it('never gives an INR figure from an FX provider whose terms are not approved', async () => {
    const evidence = await loadEvidence(db, 'Fees at Beta Synthetic University?', TODAY)
    expect(evidence.find((e) => e.ref === `tuition_fee:${ids.gbp}`)?.text).toContain('GBP 28000.00')
    expect(evidence.some((e) => e.ref.endsWith(':inr'))).toBe(false)
  })

  it('compares two universities in different destinations, both with their facts', async () => {
    const q = 'Compare tuition fees at Alpha Synthetic University and Beta Synthetic University'
    const evidence = await loadEvidence(db, q, TODAY)
    expect(evidence.map((e) => e.ref)).toEqual(expect.arrayContaining([`university:${alpha}`, `university:${beta}`, `tuition_fee:${ids.gbp}`, `tuition_fee:${ids.fee}`]))
    expect(analyseQuestion(q, evidence).note).toMatch(/compares 2 universities/)
  })

  it('compares destinations with published listings only', async () => {
    const evidence = await loadEvidence(db, 'Germany or the UK for a masters?', TODAY)
    expect(evidence.map((e) => e.ref).sort()).toEqual([`university:${alpha}`, `university:${beta}`].sort())
    expect(evidence.every((e) => /is listed in the LockIn directory/.test(e.text))).toBe(true)
  })

  it('never passes a conditional QS ranking to the AI provider', async () => {
    const [[qs]] = await db.query<RowDataPacket[]>("SELECT id FROM ranking_providers WHERE slug = 'qs'")
    await insert('university_rankings', { university_id: alpha, provider_id: qs.id, ranking_year: YEAR, rank_position: 42, ...live() })
    await db.query("UPDATE ranking_providers SET rights_status = 'conditional', licence_reference = 'SYN-COND', rights_checked_at = UTC_DATE(), rights_notes = 'Synthetic: conditional, no display, no AI use', allow_ai_use = 1 WHERE id = ?", [qs.id])
    try {
      const evidence = await loadEvidence(db, 'What is the ranking of Alpha Synthetic University?', TODAY)
      expect(evidence.some((e) => e.ref.startsWith('university_ranking:'))).toBe(false)
      expect(JSON.stringify(evidence)).not.toContain('#42')
    } finally {
      await db.query("UPDATE ranking_providers SET rights_status = 'not_confirmed', licence_reference = NULL, rights_notes = NULL, allow_ai_use = 0 WHERE id = ?", [qs.id])
    }
  })

  it('end to end: a sourced answer from the mock is low risk and links the source in plain words', async () => {
    const question = 'What is the tuition fee at Alpha Synthetic University?'
    const evidence = await loadEvidence(db, question, TODAY)
    const guidance = analyseQuestion(question, evidence)
    const r = await new MockProvider().generate({ question, history: [], evidence, instructions: DEREK_INSTRUCTIONS, guidance }, { signal: new AbortController().signal })
    expect(r.text).toContain('([Alpha University (synthetic)](https://alpha.example/msc-data/fees))')
    expect(r.text).not.toMatch(/Not yet checked by LockIn|UNVERIFIED|\(source:|\(official source:|accessed 20|checked 20|From the LockIn directory|evidence:/)
    expect(assessDraft(r.text, assessQuestion(question, evidence), evidence)).toEqual({ level: 'low', reasons: [] })
  })
})

describe('Derek retrieval from draft records (unverified, labelled)', () => {
  it('uses a draft university with every fact labelled UNVERIFIED and its own (or per-field) source', async () => {
    const evidence = await loadEvidence(db, 'What are the fees and deadlines at Delta Draft University?', TODAY)
    expect(evidence.map((e) => e.ref)).toEqual([`draft_university:${ids.delta}`, `draft_course:${ids.deltaCourse}`, `draft_course:${ids.deltaCourse}:requirements`, `draft_tuition_fee:${ids.deltaFee}`, `draft_course_intake:${ids.deltaIntake}`])
    for (const e of evidence) expect(e).toMatchObject({ unverified: true, text: expect.stringMatching(/^UNVERIFIED, not yet checked by LockIn: /), publisher: 'Delta University (synthetic)' })
    const fee = evidence.find((e) => e.ref.startsWith('draft_tuition_fee:'))!
    expect(fee).toMatchObject({ text: expect.stringContaining('CAD 31234.00 per year'), sourceUrl: 'https://delta.example/fees', checkedAt: '2026-11-02' })
    expect(evidence.find((e) => e.ref.startsWith('draft_course_intake:'))?.text).toContain(`application deadline ${YEAR + 1}-01-15`)
    expect(evidence[0]).toMatchObject({ sourceUrl: 'https://delta.example/msc', checkedAt: '2026-11-01' })
  })

  it('never uses a withdrawn record or a draft without a source', async () => {
    expect(await loadEvidence(db, 'Fees at Epsilon Withdrawn University?', TODAY)).toEqual([])
    expect(JSON.stringify(await loadEvidence(db, 'Fees at Alpha Synthetic University?', TODAY))).not.toMatch(/99999|Hidden Draft/)
  })

  it('adds a published university’s draft fee after its verified facts, labelled, and never as verified', async () => {
    const evidence = await loadEvidence(db, 'Fees at Alpha Synthetic University?', TODAY)
    const draftFee = evidence.find((e) => e.ref === `draft_tuition_fee:${ids.alphaDraftFee}`)
    expect(draftFee).toMatchObject({ unverified: true, text: expect.stringMatching(/^UNVERIFIED.*EUR 1550\.00 per semester/) })
    expect(evidence.filter((e) => !e.unverified).every((e) => !e.text.includes('1550'))).toBe(true)
    expect(evidence.findIndex((e) => e.unverified)).toBeGreaterThan(evidence.findIndex((e) => e.ref === `tuition_fee:${ids.fee}`))
  })

  it('lists draft universities for a broad destination question, labelled, after verified ones', async () => {
    const evidence = await loadEvidence(db, 'Tell me about universities in Canada', TODAY)
    expect(evidence).toEqual([expect.objectContaining({ ref: `draft_university:${ids.delta}`, unverified: true, text: expect.stringContaining("is in LockIn's draft records") })])
  })

  it('end to end: the mock answers from a draft record with its source linked, and that answer is low risk', async () => {
    const question = 'What is the tuition fee at Delta Draft University?'
    const evidence = await loadEvidence(db, question, TODAY)
    const guidance = analyseQuestion(question, evidence)
    const r = await new MockProvider().generate({ question, history: [], evidence, instructions: DEREK_INSTRUCTIONS, guidance }, { signal: new AbortController().signal })
    // The draft record's fact is attributed to its source by a link, and no internal wording reaches the student.
    expect(r.text).toMatch(/\]\(https:\/\//)
    expect(r.text).not.toMatch(/Not yet checked by LockIn|UNVERIFIED|\(source:|\(official source:|accessed 20|checked 20|From the LockIn directory|evidence:/)
    expect(assessDraft(r.text, assessQuestion(question, evidence), evidence)).toEqual({ level: 'low', reasons: [] })
  })
})
