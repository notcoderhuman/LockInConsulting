import type { RowDataPacket } from 'mysql2/promise'
import { todayIso } from '@/lib/data/publication'
import { fetchDestinationDirectory, type Queryable } from '@/lib/db/directory-queries'
import type { SourceRef } from '@/lib/data/types'
import { MONTH_NAMES } from '@/lib/admin/entities'
import { detectDestinations } from './guidance'
import { UNVERIFIED_TAG, type EvidenceItem } from './provider'

// Derek's only knowledge source: the same public_* views the website renders. Those views already
// exclude drafts, unverified and expired records, fees past valid_to, rankings without reuse
// rights, and unapproved exchange rates. Nothing here reads base tables, db/intake/ research files,
// the rejected PDF, or any hard-coded list. Derek never converts currencies himself: an INR figure
// is only the one the website shows (lib/data/money.ts, a fresh approved rate), with its rate date
// and FX source. Every item carries its own source URL, publisher and checked date.

const MAX_UNIVERSITIES = 3
const MAX_ITEMS = 25
const MAX_LISTINGS_PER_DESTINATION = 5

/** A fee for an academic year that has already ended is stale even if its record is still live. */
export function isStaleAcademicYear(academicYear: string | null, today = todayIso()): boolean {
  if (!academicYear) return false
  const years = academicYear.match(/\d{4}/g)?.map(Number) ?? []
  const short = /^\d{4}\s*[/-]\s*(\d{2})$/.exec(academicYear.trim())
  const last = short ? Math.floor(years[0] / 100) * 100 + Number(short[1]) : Math.max(...years)
  if (!Number.isFinite(last)) return false
  // An academic year "2025/26" ends in 2026; "2025" is treated as ending in 2025.
  return last < Number(today.slice(0, 4))
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const cite = (s: SourceRef) => ({ sourceUrl: s.url, publisher: s.publisher, checkedAt: s.checkedAt })

export async function loadEvidence(db: Queryable, question: string, today = todayIso()): Promise<EvidenceItem[]> {
  const [unis] = await db.query<RowDataPacket[]>('SELECT id, name, slug, destination_iso2 FROM public_universities')
  const q = ` ${norm(question)} `
  const named = (u: RowDataPacket) => q.includes(` ${norm(String(u.name))} `) || q.includes(` ${norm(String(u.slug))} `)
  const matched = unis.filter(named).slice(0, MAX_UNIVERSITIES)
  const draftUnis = (await selectDrafts(db, `SELECT u.id, u.name, u.slug, u.city, u.official_website, ${SOURCE_OF('u')} FROM universities u ${JOIN_SOURCE('u')} WHERE ${DRAFT('u')}`, [])).filter(named)
  const matchedDrafts = draftUnis.slice(0, MAX_UNIVERSITIES - matched.length)
  if (!matched.length && !matchedDrafts.length) return destinationListings(db, question, today)

  // A comparison gets an even share per university, so the first one cannot crowd out the others.
  const perUniversity = Math.floor(MAX_ITEMS / (matched.length + matchedDrafts.length))
  const unverified = await unverifiedFacts(db, [...matched.map((u) => Number(u.id)), ...matchedDrafts.map((u) => Number(u.id))], today)
  const items: EvidenceItem[] = []
  for (const iso of new Set(matched.map((u) => String(u.destination_iso2)))) {
    const directory = await fetchDestinationDirectory(db, iso, today)
    for (const u of directory.filter((d) => matched.some((m) => Number(m.id) === d.id))) {
      const own: EvidenceItem[] = []
      own.push({ ref: `university:${u.id}`, text: `${u.name}${u.city ? `, ${u.city}` : ''}, official website ${u.officialWebsite}`, ...cite(u.source) })
      // A rank goes to the AI provider only when the licence allows it (allow_ai_use, D-042).
      for (const r of u.rankings.filter((x) => x.aiUseAllowed)) {
        const pos = r.position != null ? `#${r.position}` : `${r.bandLow}–${r.bandHigh}`
        own.push({ ref: `university_ranking:${r.id}`, text: `${u.name} ranking: ${r.providerName} ${r.year}${r.subject ? ` (${r.subject})` : ''}: ${pos}`, ...cite(r.source) })
      }
      for (const a of u.acceptanceRates)
        own.push({
          ref: `acceptance_rate:${a.id}`,
          text: a.ratePercent == null
            ? `${u.name} acceptance rate (${a.cohortLabel}): checked and not publicly available`
            : `${u.name} acceptance rate (${a.cohortLabel}): ${a.ratePercent}% — ${a.definition}`,
          ...cite(a.source),
        })
      for (const c of u.courses) {
        own.push({
          ref: `course:${c.id}`,
          text: `${u.name} offers ${c.name}${c.durationMonths ? `, ${c.durationMonths} months` : ''}${c.courseUrl ? `; course and admissions page ${c.courseUrl}` : ''}`,
          ...cite(c.source),
        })
        if (c.entryRequirements) own.push({ ref: `course:${c.id}:requirements`, text: `${c.name} entry requirements: ${c.entryRequirements}`, ...cite(c.source) })
        if (c.languageRequirements) own.push({ ref: `course:${c.id}:language`, text: `${c.name} language requirements: ${c.languageRequirements}`, ...cite(c.source) })
        for (const f of c.fees) {
          const what = `${c.name} tuition fee (${f.category.replace(/_/g, ' ')})`
          // Missing or out-of-date figures are stated as such, never with the old amount.
          if (f.amount == null) {
            own.push({ ref: `tuition_fee:${f.id}`, text: `${what}: checked and not publicly available`, ...cite(f.source) })
            continue
          }
          if (isStaleAcademicYear(f.academicYear, today)) {
            own.push({ ref: `tuition_fee:${f.id}`, text: `${what}: the published figure is for an academic year that has ended, so LockIn has no current fee`, ...cite(f.source) })
            continue
          }
          own.push({
            ref: `tuition_fee:${f.id}`,
            text: `${what}: ${f.currency} ${f.amount} ${f.billingPeriod.replace(/_/g, ' ')}${f.academicYear ? `, academic year ${f.academicYear}` : ''}`,
            ...cite(f.source),
          })
          if (f.inr)
            own.push({
              ref: `tuition_fee:${f.id}:inr`,
              text: `${what} in Indian rupees: approximately INR ${f.inr.amountInr} at ${f.currency} 1 = INR ${Number(f.inr.rate)} (rate date ${f.inr.rateDate}); an estimate, the university charges in ${f.currency}`,
              sourceUrl: f.inr.sourceUrl,
              publisher: f.inr.providerName ?? f.inr.sourceTitle,
              checkedAt: f.inr.rateDate,
            })
        }
        for (const i of c.intakes)
          own.push({
            ref: `course_intake:${i.id}`,
            text: `${c.name} intake: ${MONTH_NAMES[i.month - 1]}${i.year ? ` ${i.year}` : ''}, ${i.applicationDeadline ? `application deadline ${i.applicationDeadline}` : 'application deadline not published in the LockIn directory'}`,
            ...cite(i.source),
          })
      }
      // Verified facts first; the university's draft records fill any room left, labelled.
      items.push(...[...own, ...(unverified.get(u.id) ?? [])].slice(0, perUniversity))
    }
  }
  for (const d of matchedDrafts)
    items.push(...[draftItem(`draft_university:${d.id}`, `${d.name}${d.city ? `, ${d.city}` : ''}, official website ${d.official_website}`, d), ...(unverified.get(Number(d.id)) ?? [])].slice(0, perUniversity))
  return items
}

// ---- Draft records (owner decision, 6 Nov 2026) ------------------------------------------------
// The directory holds imported records that LockIn has not checked yet. Derek may use them, but every
// such fact is labelled UNVERIFIED and carries its own source; they never count as verified and never
// reach the public directory pages. Only 'draft' and 'in_review' rows: a withdrawn ('unpublished')
// record and a published record past its review date stay out. No rankings and no INR from drafts.

const DRAFT = (a: string) => `${a}.publication_status IN ('draft', 'in_review')`
const JOIN_SOURCE = (a: string) => `JOIN sources s ON s.id = ${a}.source_id`
const SOURCE_OF = (a: string) => `s.url AS src_url, s.publisher AS src_publisher, DATE_FORMAT(COALESCE(${a}.checked_at, s.retrieved_at, s.created_at), '%Y-%m-%d') AS src_date`

async function selectDrafts(db: Queryable, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params)
  return rows
}

// Any row selected with SOURCE_OF (src_url, src_publisher, src_date).
type SourceRow = Record<string, unknown>
const draftItem = (ref: string, text: string, s: SourceRow): EvidenceItem => ({
  ref,
  text: `${UNVERIFIED_TAG}: ${text}`,
  sourceUrl: String(s.src_url),
  publisher: String(s.src_publisher),
  checkedAt: String(s.src_date),
  unverified: true,
})

/** Draft courses, requirements, intakes and fees of the given universities, grouped by university id. */
async function unverifiedFacts(db: Queryable, universityIds: number[], today: string): Promise<Map<number, EvidenceItem[]>> {
  const out = new Map<number, EvidenceItem[]>()
  if (!universityIds.length) return out
  const add = (uniId: unknown, item: EvidenceItem) => out.set(Number(uniId), [...(out.get(Number(uniId)) ?? []), item])
  // Every course of these universities (except withdrawn ones), so a published course's draft fee is found too.
  const courses = await selectDrafts(
    db,
    `SELECT c.id, c.university_id, c.name, c.duration_months, c.course_url, c.entry_requirements, c.language_requirements, ${DRAFT('c')} AS is_draft, u.name AS uni_name, ${SOURCE_OF('c')}
       FROM courses c JOIN universities u ON u.id = c.university_id ${JOIN_SOURCE('c')}
      WHERE c.university_id IN (?) AND c.publication_status <> 'unpublished' ORDER BY c.name`,
    [universityIds],
  )
  if (!courses.length) return out
  const courseIds = courses.map((c) => Number(c.id))
  const [fees, intakes, fields] = await Promise.all([
    selectDrafts(db, `SELECT f.*, ${SOURCE_OF('f')} FROM tuition_fees f ${JOIN_SOURCE('f')} WHERE f.course_id IN (?) AND ${DRAFT('f')} ORDER BY f.id`, [courseIds]),
    selectDrafts(db, `SELECT i.*, DATE_FORMAT(i.application_deadline, '%Y-%m-%d') AS deadline, ${SOURCE_OF('i')} FROM course_intakes i ${JOIN_SOURCE('i')} WHERE i.course_id IN (?) AND ${DRAFT('i')} ORDER BY i.intake_year, i.intake_month`, [courseIds]),
    // A field taken from a different page than its record (lockin-import@1 fieldSources) cites that page.
    // shortcut: reads every course/intake/fee field source (hundreds of rows today); filter by id if it reaches tens of thousands.
    selectDrafts(
      db,
      `SELECT fs.entity_type, fs.entity_id, fs.field_name, s.url AS src_url, s.publisher AS src_publisher, DATE_FORMAT(fs.accessed_on, '%Y-%m-%d') AS src_date
         FROM field_sources fs JOIN sources s ON s.id = fs.source_id
        WHERE fs.entity_type IN ('course', 'course_intake', 'tuition_fee') AND fs.status <> 'discontinued'`,
      [],
    ),
  ])
  const fieldSource = new Map(fields.map((f) => [`${f.entity_type}:${f.entity_id}:${f.field_name}`, f as SourceRow]))
  const src = (entity: string, row: RowDataPacket, field: string): SourceRow => fieldSource.get(`${entity}:${row.id}:${field}`) ?? (row as SourceRow)
  const course = new Map(courses.map((c) => [Number(c.id), c]))

  for (const c of courses) {
    if (!Number(c.is_draft)) continue
    add(c.university_id, draftItem(`draft_course:${c.id}`, `${c.uni_name} offers ${c.name}${c.duration_months ? `, ${c.duration_months} months` : ''}${c.course_url ? `; course and admissions page ${c.course_url}` : ''}`, src('course', c, 'course_url')))
    if (c.entry_requirements) add(c.university_id, draftItem(`draft_course:${c.id}:requirements`, `${c.name} entry requirements: ${c.entry_requirements}`, src('course', c, 'entry_requirements')))
    if (c.language_requirements) add(c.university_id, draftItem(`draft_course:${c.id}:language`, `${c.name} language requirements: ${c.language_requirements}`, src('course', c, 'language_requirements')))
  }
  for (const f of fees) {
    const c = course.get(Number(f.course_id))
    // No figure, or one for an academic year that has ended: nothing worth quoting, even labelled.
    if (!c || f.amount == null || isStaleAcademicYear(f.academic_year == null ? null : String(f.academic_year), today)) continue
    const period = String(f.billing_period).replace(/_/g, ' ')
    add(c.university_id, draftItem(`draft_tuition_fee:${f.id}`, `${c.name} tuition fee (${String(f.fee_category).replace(/_/g, ' ')}): ${f.currency} ${f.amount} ${period}${f.academic_year ? `, academic year ${f.academic_year}` : ''}`, src('tuition_fee', f, 'amount')))
  }
  for (const i of intakes) {
    const c = course.get(Number(i.course_id))
    if (!c) continue
    const deadline = i.deadline ? `application deadline ${i.deadline}` : 'no application deadline recorded'
    add(c.university_id, draftItem(`draft_course_intake:${i.id}`, `${c.name} intake: ${MONTH_NAMES[Number(i.intake_month) - 1]}${i.intake_year ? ` ${i.intake_year}` : ''}, ${deadline}`, src('course_intake', i, i.application_deadline ? 'application_deadline' : 'intake_month')))
  }
  return out
}

/**
 * Broad questions ("Tell me about UK universities", "UK or Germany?") name destinations but no
 * university. Offer each destination's published, verified directory listings (name, city, official
 * website), then draft records labelled UNVERIFIED; never facts about them that the student did not ask for.
 */
async function destinationListings(db: Queryable, question: string, today: string): Promise<EvidenceItem[]> {
  const items: EvidenceItem[] = []
  for (const destination of detectDestinations(question).slice(0, 2)) {
    const listed = await fetchDestinationDirectory(db, destination.iso2, today)
    for (const u of listed.slice(0, MAX_LISTINGS_PER_DESTINATION))
      items.push({
        ref: `university:${u.id}`,
        text: `${u.name}${u.city ? `, ${u.city}` : ''} (${destination.shortName}) is listed in the LockIn directory; official website ${u.officialWebsite}`,
        ...cite(u.source),
      })
    // Room left: the destination's draft records, labelled as not yet checked.
    const room = MAX_LISTINGS_PER_DESTINATION - Math.min(listed.length, MAX_LISTINGS_PER_DESTINATION)
    if (room > 0)
      for (const d of await selectDrafts(db, `SELECT u.id, u.name, u.city, u.official_website, ${SOURCE_OF('u')} FROM universities u ${JOIN_SOURCE('u')} WHERE u.destination_iso2 = ? AND ${DRAFT('u')} ORDER BY u.name, u.id LIMIT ?`, [destination.iso2, room]))
        items.push(draftItem(`draft_university:${d.id}`, `${d.name}${d.city ? `, ${d.city}` : ''} (${destination.shortName}) is in LockIn's draft records; official website ${d.official_website}`, d))
  }
  return items
}
