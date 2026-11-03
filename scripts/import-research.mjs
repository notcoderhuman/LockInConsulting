// Imports the PRIVATE university research (kept outside this repository) into the directory tables
// as records waiting for review. Nothing is ever verified or published here: every record is
// created as draft/unverified and submitted for review, exactly as an editor would in /admin, with
// both steps in the audit log. A reviewer must still check each one against its source.
//
//   node scripts/import-research.mjs --dir <research folder>            (dry run: report only)
//   node scripts/import-research.mjs --dir <research folder> --apply    (back up, then import)
//
// Rules:
// - Only a local database (127.0.0.1 / localhost) unless --allow-remote is given deliberately,
//   after a backup and with the owner's approval. Never with NODE_ENV=production.
// - Stable identities: universities by destination + slug, courses by university + slug, sources by
//   URL. An existing university is never touched (not overwritten, not duplicated), so re-running
//   is safe.
// - A fact is imported only when the research quotes the source ('…' excerpt) AND cites a specific
//   page (not just a home page). Anything else is reported as missing evidence, not imported.
// - Rankings are never read or written (D-014).
// - With --check-websites, each NEW university's official website is fetched once (a normal page
//   request, honest user agent). Only if it answers over https on the same domain, its title names
//   the institution and the name says it is a university (not, e.g., a polytechnic) is the record
//   listed provisionally: name, website and (if the page states it) city, labelled "Not yet verified"
//   (D-043). Everything else is kept for review with the reason in its notes, never deleted.
// - --universities-only leaves out every course, campus, intake and fee in the research.
// - --identity-from <file> replays recorded website checks instead of fetching the sites again, so a
//   second database gets exactly the same labels and dates.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import mysql from 'mysql2/promise'
import { appendChangeLogRow } from '../lib/admin/audit-core.mjs'
import { enforceSession } from '../lib/db/session.mjs'

const ACTOR = 'cli:research-import'
const QUALIFICATIONS = ['foundation', 'certificate', 'diploma', 'bachelor', 'master', 'doctorate', 'other']
const STUDY_MODES = ['full_time', 'part_time', 'online', 'blended']
const FEE_CATEGORIES = ['international', 'domestic', 'eu_eea', 'other']
const BILLING_PERIODS = ['per_year', 'per_semester', 'per_term', 'per_credit', 'total_programme']
const CURRENCIES = ['USD', 'GBP', 'CAD', 'EUR', 'AUD', 'NZD', 'SAR', 'AED', 'PLN', 'INR']
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DIRECTORY_TABLES = ['sources', 'universities', 'campuses', 'courses', 'course_intakes', 'tuition_fees']

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}
const quotes = (evidence) => /['"‘“][^'"’”]{12,}['"’”]/.test(String(evidence ?? ''))
const specificPage = (u) => isHttps(u) && new URL(u).pathname.replace(/\/+$/, '').length > 0

/** Why a research fact cannot be imported, or null when it is quoted from a specific official page. */
export function factProblem(fact) {
  if (!fact) return 'not researched'
  if (fact.result !== 'captured') return `research result "${fact.result}"`
  if (!ISO_DATE.test(String(fact.checkedAt))) return 'no check date'
  if (!specificPage(fact.sourceUrl)) return 'source is not a specific page'
  if (!quotes(fact.evidence)) return 'no quoted evidence'
  return null
}

// shortcut: the category is read from the official name only; a reviewer can list any held record
// after checking it (admin → Provisional public listing). Upgrade if a recognised-institution register is adopted.
const UNIVERSITY_NAME = /universit|college|institute of technology|school of economics|hochschule|politecnico|akademi/i
export function categoryProblem(name) {
  return UNIVERSITY_NAME.test(String(name)) ? null : 'institutional category not established (the name does not identify a university)'
}

const fold = (v) => String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const GENERIC = new Set(['university', 'universita', 'universitat', 'universite', 'universidad', 'the', 'and', 'of', 'in', 'di', 'de', 'du', 'zu', 'del', 'degli', 'studi', 'college', 'institute', 'technology', 'science', 'sciences', 'state', 'national'])
const stripWww = (h) => h.replace(/^www\./, '')
const sameSite = (a, b) => {
  const [x, y] = [stripWww(a), stripWww(b)]
  return x === y || x.endsWith('.' + y) || y.endsWith('.' + x)
}

/** Judges one fetched official website against the research record. Pure: no network. */
export function judgeWebsite(record, { status, finalUrl, title, text }) {
  const original = new URL(record.identity.url)
  let final
  try {
    final = new URL(finalUrl)
  } catch {
    return { ok: false, problem: 'no final address' }
  }
  if (status < 200 || status >= 300) return { ok: false, problem: 'website answered HTTP ' + status }
  if (final.protocol !== 'https:') return { ok: false, problem: 'website is not served over https' }
  if (!sameSite(original.hostname, final.hostname)) return { ok: false, problem: 'website redirected to another domain (' + final.hostname + ')' }
  const tokens = fold(record.officialName).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC.has(t))
  const t = fold(title)
  const named = tokens.length ? tokens.some((tok) => t.includes(tok)) : t.includes(fold(record.officialName))
  if (!named) return { ok: false, problem: 'page title does not name the institution ("' + String(title ?? '').slice(0, 120) + '")' }
  const city = fold(record.city)
  const cityConfirmed = Boolean(city) && (fold(text).includes(city) || t.includes(city))
  return {
    ok: true,
    cityConfirmed,
    evidence: 'Official website ' + final.href + ' answered HTTP ' + status + '; page title "' + String(title).trim().slice(0, 200) + '"' + (cityConfirmed ? '; the page names ' + record.city : '') + '.',
  }
}

/** Fetches an official website once and judges it. Network errors are reported, never thrown. */
export async function checkWebsite(record) {
  try {
    const res = await fetch(record.identity.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'LockInConsulting-IdentityCheck/1.0 (one page per university; manual research)', accept: 'text/html' },
    })
    const html = (await res.text()).slice(0, 400_000)
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").trim()
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    return judgeWebsite(record, { status: res.status, finalUrl: res.url, title, text })
  } catch (error) {
    return { ok: false, problem: 'website could not be reached (' + (error instanceof Error ? error.name : 'error') + ')' }
  }
}

/** Reads every research file; the first copy of each destination + slug wins, later copies are reported. */
export function loadResearch(dir) {
  const files = [
    ...readdirSync(path.join(dir, 'destinations')).filter((f) => f.endsWith('.json')).sort().map((f) => path.join('destinations', f)),
    ...readdirSync(dir).filter((f) => f.endsWith('.json')).sort(),
  ]
  const byKey = new Map()
  const duplicates = []
  const conflicts = []
  for (const file of files) {
    const data = JSON.parse(readFileSync(path.join(dir, file), 'utf8'))
    if (data.status !== 'pending_admin_entry') throw new Error(`${file}: expected status pending_admin_entry, found ${data.status}`)
    for (const record of data.records ?? []) {
      const key = `${record.destinationIso2}:${record.slug}`
      const first = byKey.get(key)
      if (!first) byKey.set(key, { record, file })
      else {
        duplicates.push({ key, file, keptFrom: first.file })
        if (JSON.stringify(first.record.facts) !== JSON.stringify(record.facts) || first.record.identity?.url !== record.identity?.url)
          conflicts.push({ key, file, keptFrom: first.file })
      }
    }
  }
  return { records: [...byKey.values()].map((v) => ({ ...v.record, _file: v.file })), duplicates, conflicts }
}

const note = (fact) =>
  `Imported research lead, NOT verified. Research claimed on ${fact.checkedAt}${fact.validity ? ` (${fact.validity})` : ''}: ${String(fact.evidence).slice(0, 1500)}`

/** Maps one research record to rows, listing every fact left out and why. Pure: no database. */
export function planRecord(r) {
  const skipped = []
  const id = r.identity ?? {}
  const uniProblems = [
    !/^[A-Z]{2}$/.test(String(r.destinationIso2)) && 'destination',
    !SLUG.test(String(r.slug)) && 'slug',
    !String(r.officialName ?? '').trim() && 'name',
    !isHttps(id.url) && 'official website',
    !ISO_DATE.test(String(id.checkedAt)) && 'identity check date',
  ].filter(Boolean)
  if (uniProblems.length) return { university: null, skipped: [`university: invalid ${uniProblems.join(', ')}`] }

  const university = {
    row: {
      destination_iso2: r.destinationIso2,
      slug: r.slug,
      name: r.officialName.trim(),
      official_website: id.url,
      city: r.city || null,
      sub_region: r.subRegion || null,
      institution_type: ['public', 'private'].includes(r.institutionType) ? r.institutionType : 'unknown',
    },
    source: { url: id.url, title: id.pageTitle || r.officialName, publisher: r.officialName, checkedAt: id.checkedAt },
    notes: `Imported research lead, NOT verified. Official website responded on ${id.checkedAt} (HTTP ${id.httpStatus ?? '?'}, page title "${id.pageTitle ?? ''}").`,
  }

  const fact = (field) => r.facts?.find((f) => f.field === field)
  const usable = (field) => {
    const f = fact(field)
    const problem = factProblem(f)
    if (problem) skipped.push(`${field}: ${problem}`)
    return problem ? null : f
  }

  let course = null
  const programme = usable('programme')
  const p = programme?.value ?? {}
  if (programme) {
    const bad = [
      !SLUG.test(String(p.slug)) && 'slug',
      !String(p.name ?? '').trim() && 'name',
      !QUALIFICATIONS.includes(p.qualification) && 'qualification',
      !['UG', 'PG'].includes(p.studyLevel) && 'study level',
      p.studyMode != null && !STUDY_MODES.includes(p.studyMode) && 'study mode',
      p.durationMonths != null && !(Number.isInteger(p.durationMonths) && p.durationMonths > 0 && p.durationMonths <= 120) && 'duration',
      p.url != null && !isHttps(p.url) && 'course page',
    ].filter(Boolean)
    if (bad.length) skipped.push(`programme: invalid ${bad.join(', ')}`)
    else
      course = {
        row: {
          slug: p.slug,
          name: p.name.trim(),
          qualification: p.qualification,
          study_level: p.studyLevel,
          duration_months: p.durationMonths ?? null,
          study_mode: p.studyMode ?? null,
          teaching_language: p.teachingLanguage || null,
          course_url: p.url ?? null,
          entry_requirements: null,
          language_requirements: null,
        },
        source: { url: programme.sourceUrl, publisher: programme.publisher, checkedAt: programme.checkedAt },
        notes: [note(programme)],
        campus: typeof p.campus === 'string' && p.campus.trim() ? p.campus.trim() : null,
      }
  }

  for (const [field, column] of [['entry_requirements', 'entry_requirements'], ['language_requirements', 'language_requirements']]) {
    const f = usable(field)
    if (!f) continue
    if (!course) skipped.push(`${field}: no imported course to attach to`)
    else if (typeof f.value !== 'string' || !f.value.trim()) skipped.push(`${field}: not a quoted text value`)
    else {
      course.row[column] = f.value.trim()
      course.notes.push(`${field}: ${note(f)} Source: ${f.sourceUrl}`)
    }
  }

  let intake = null
  const i = usable('intake_deadline')
  if (i && !course) skipped.push('intake_deadline: no imported course to attach to')
  else if (i) {
    const v = i.value ?? {}
    const ok = Number.isInteger(v.intakeMonth) && v.intakeMonth >= 1 && v.intakeMonth <= 12 && (v.intakeYear == null || Number.isInteger(v.intakeYear)) && (v.applicationDeadline == null || ISO_DATE.test(v.applicationDeadline))
    if (!ok) skipped.push('intake_deadline: invalid month, year or deadline')
    else
      intake = {
        row: { intake_month: v.intakeMonth, intake_year: v.intakeYear ?? null, application_deadline: v.applicationDeadline ?? null },
        source: { url: i.sourceUrl, publisher: i.publisher, checkedAt: i.checkedAt },
        notes: note(i),
      }
  }

  let fee = null
  const t = usable('tuition_fee')
  if (t && !course) skipped.push('tuition_fee: no imported course to attach to')
  else if (t) {
    const v = t.value ?? {}
    const bad = [
      !FEE_CATEGORIES.includes(v.feeCategory) && 'fee category',
      !BILLING_PERIODS.includes(v.billingPeriod) && 'billing period',
      !CURRENCIES.includes(v.currency) && 'currency',
      v.amount != null && !/^\d{1,12}(\.\d{1,2})?$/.test(String(v.amount)) && 'amount',
      v.academicYear != null && !/^\d{4}-\d{4}$/.test(v.academicYear) && 'academic year',
    ].filter(Boolean)
    if (bad.length) skipped.push(`tuition_fee: invalid ${bad.join(', ')}`)
    else
      fee = {
        row: {
          fee_category: v.feeCategory,
          amount: v.amount == null ? null : String(v.amount),
          currency: v.currency,
          billing_period: v.billingPeriod,
          academic_year: v.academicYear ?? null,
          fee_notes: v.notes ?? null,
        },
        source: { url: t.sourceUrl, publisher: t.publisher, checkedAt: t.checkedAt },
        notes: note(t),
      }
  }

  return { university, course, intake, fee, skipped }
}

async function findOrCreateSource(conn, s, summary) {
  const [found] = await conn.query('SELECT id FROM sources WHERE url_sha256 = SHA2(?, 256)', [s.url])
  if (found.length) return Number(found[0].id)
  const publisher = String(s.publisher || new URL(s.url).hostname).slice(0, 200)
  const [res] = await conn.query(
    'INSERT INTO sources (url, title, publisher, source_type, retrieved_at, notes, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [s.url, String(s.title || `Page cited by the research (title not recorded): ${publisher}`).slice(0, 300), publisher, 'university_official', s.checkedAt, 'Cited by the private research import. Not verified.', ACTOR],
  )
  const [[after]] = await conn.query('SELECT * FROM sources WHERE id = ?', [res.insertId])
  await appendChangeLogRow(conn, { entityType: 'source', entityId: res.insertId, action: 'create', actorId: ACTOR, actorRole: 'cli', reason: null, before: null, after })
  summary.sourcesCreated += 1
  return res.insertId
}

/** Same two steps as createRecord + submit_for_review in lib/admin/workflow.ts, both audited. */
async function createForReview(conn, logType, table, row, notes) {
  const [res] = await conn.query(`INSERT INTO ${table} SET ?`, [{ ...row, publication_status: 'draft', verification_status: 'unverified', verification_notes: notes }])
  const [[created]] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [res.insertId])
  await appendChangeLogRow(conn, { entityType: logType, entityId: res.insertId, action: 'create', actorId: ACTOR, actorRole: 'cli', reason: null, before: null, after: created })
  await conn.query(`UPDATE ${table} SET publication_status = 'in_review' WHERE id = ? AND publication_status = 'draft'`, [res.insertId])
  const [[submitted]] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [res.insertId])
  await appendChangeLogRow(conn, { entityType: logType, entityId: res.insertId, action: 'submit_for_review', actorId: ACTOR, actorRole: 'cli', reason: null, before: created, after: submitted })
  return res.insertId
}

/**
 * Imports planned records, one transaction per university. Returns counts; never prints data.
 * @param {import('mysql2/promise').Pool} pool
 * @param {any[]} records
 * @param {{ checkWebsite?: ((record: any) => Promise<{ ok: boolean, problem?: string, cityConfirmed?: boolean, evidence?: string }>) | null, today?: string, universitiesOnly?: boolean, identity?: Map<string, any> | null }} [options]
 *   universitiesOnly: skip every course, campus, intake and fee in the research.
 *   identity: recorded results keyed by destination:slug, replayed instead of fetching the websites again.
 */
export async function importResearch(pool, records, { checkWebsite: check = null, today = new Date().toISOString().slice(0, 10), universitiesOnly = false, identity = null } = {}) {
  const summary = { universitiesCreated: 0, universitiesExisting: 0, invalid: 0, provisional: 0, held: [], coursesCreated: 0, campusesCreated: 0, intakesCreated: 0, feesCreated: 0, sourcesCreated: 0, failed: [] }
  for (const record of records) {
    const plan = planRecord(record)
    if (!plan.university) {
      summary.invalid += 1
      continue
    }
    const key = plan.university.row.destination_iso2 + ':' + plan.university.row.slug
    // Existing records are never touched, so their websites are not fetched again either.
    const [known] = await pool.query('SELECT id FROM universities WHERE destination_iso2 = ? AND slug = ?', [plan.university.row.destination_iso2, plan.university.row.slug])
    let listing = { provisional_listing: 0 }
    let heldNote = null
    if (!known.length && identity) {
      const recorded = identity.get(key)
      if (!recorded) {
        summary.failed.push(`${key}: no recorded identity check`)
        continue
      }
      listing = recorded.listing
      heldNote = recorded.heldNote
      if (recorded.name) plan.university.row.name = recorded.name
      if (heldNote) summary.held.push(key + ': ' + heldNote)
    } else if (!known.length && check) {
      const category = categoryProblem(record.officialName)
      const site = category ? null : await check(record)
      const problem = category ?? (site.ok ? null : site.problem)
      if (problem) {
        // Listed publicly by name only (D-044); a non-university name is labelled as another institution type.
        if (category) listing = { provisional_listing: 0, institution_category: 'other' }
        heldNote = 'Not listed provisionally: ' + problem + '.'
        summary.held.push(key + ': ' + problem)
      } else
        listing = { provisional_listing: 1, identity_checked_at: today, identity_city_confirmed: site.cityConfirmed && record.city ? 1 : 0, identity_evidence: site.evidence.slice(0, 1000) }
    }
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [existing] = await conn.query('SELECT id FROM universities WHERE destination_iso2 = ? AND slug = ? FOR UPDATE', [plan.university.row.destination_iso2, plan.university.row.slug])
      if (existing.length) {
        summary.universitiesExisting += 1
        await conn.commit()
        continue
      }
      const uniSource = await findOrCreateSource(conn, plan.university.source, summary)
      const universityId = await createForReview(conn, 'university', 'universities', { ...plan.university.row, ...listing, source_id: uniSource }, [plan.university.notes, heldNote].filter(Boolean).join('\n'))
      summary.universitiesCreated += 1
      if (listing.provisional_listing) summary.provisional += 1
      if (plan.course && !universitiesOnly) {
        const courseSource = await findOrCreateSource(conn, plan.course.source, summary)
        let campusId = null
        if (plan.course.campus) {
          campusId = await createForReview(conn, 'campus', 'campuses', { university_id: universityId, name: plan.course.campus.slice(0, 200), source_id: courseSource }, plan.course.notes[0])
          summary.campusesCreated += 1
        }
        const courseId = await createForReview(conn, 'course', 'courses', { ...plan.course.row, university_id: universityId, campus_id: campusId, source_id: courseSource }, plan.course.notes.join('\n\n'))
        summary.coursesCreated += 1
        for (const [child, logType, table, key] of [[plan.intake, 'course_intake', 'course_intakes', 'intakesCreated'], [plan.fee, 'tuition_fee', 'tuition_fees', 'feesCreated']]) {
          if (!child) continue
          const sourceId = await findOrCreateSource(conn, child.source, summary)
          await createForReview(conn, logType, table, { ...child.row, course_id: courseId, source_id: sourceId }, child.notes)
          summary[key] += 1
        }
      }
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      summary.failed.push(`${plan.university.row.destination_iso2}:${plan.university.row.slug}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      conn.release()
    }
  }
  return summary
}

// ---------------------------------------------------------------------------------------------
// Enrichment (--enrich): structured, programme-level research for universities ALREADY in the
// database, from <research folder>/enrichment/*.json (format "lockin-enrichment-v1"). Every fact
// carries its own verbatim quote, specific official page and check date, and belongs to ONE
// programme: a fee, intake or requirement is never copied to another course. Existing rows are
// never overwritten: courses are matched by university + slug, intakes by month + year, fees by
// category + academic year + billing period + currency. Everything new waits for review.
// ---------------------------------------------------------------------------------------------

/** Why an enrichment fact cannot be used, or null. Facts are { sourceUrl, quote, checkedAt, ... }. */
export function evidenceProblem(fact) {
  if (!fact) return 'not researched'
  if (!ISO_DATE.test(String(fact.checkedAt))) return 'no check date'
  if (!specificPage(fact.sourceUrl)) return 'source is not a specific page'
  if (String(fact.quote ?? '').trim().length < 12) return 'no verbatim quote'
  return null
}

const quoteNote = (fact) => 'Imported research lead, NOT verified. Official page checked ' + fact.checkedAt + ': "' + String(fact.quote).trim().slice(0, 1200) + '" Source: ' + fact.sourceUrl

/** Maps one programme to rows, listing what it leaves out and why. Pure: no database. */
export function planProgramme(p) {
  const skipped = []
  const bad = [
    !SLUG.test(String(p.slug)) && 'slug',
    !String(p.name ?? '').trim() && 'name',
    !QUALIFICATIONS.includes(p.qualification) && 'qualification',
    !['UG', 'PG'].includes(p.studyLevel) && 'study level',
    p.studyMode != null && !STUDY_MODES.includes(p.studyMode) && 'study mode',
    p.durationMonths != null && !(Number.isInteger(p.durationMonths) && p.durationMonths > 0 && p.durationMonths <= 120) && 'duration',
    p.url != null && !isHttps(p.url) && 'course page',
  ].filter(Boolean)
  const problem = evidenceProblem(p.evidence)
  if (bad.length || problem) return { course: null, intakes: [], fees: [], skipped: ['programme ' + (p.slug ?? '?') + ': ' + (bad.length ? 'invalid ' + bad.join(', ') : problem)] }

  const notes = [quoteNote(p.evidence)]
  const row = {
    slug: p.slug, name: p.name.trim(), qualification: p.qualification, study_level: p.studyLevel,
    duration_months: p.durationMonths ?? null, study_mode: p.studyMode ?? null, teaching_language: p.teachingLanguage || null,
    course_url: p.url ?? null, entry_requirements: null, language_requirements: null,
  }
  for (const [key, column] of [['entryRequirements', 'entry_requirements'], ['languageRequirements', 'language_requirements']]) {
    const fact = p[key]
    if (!fact) continue
    const why = evidenceProblem(fact) ?? (String(fact.value ?? '').trim() ? null : 'no value')
    if (why) skipped.push(p.slug + ' ' + key + ': ' + why)
    else {
      row[column] = String(fact.value).trim()
      notes.push(key + ': ' + quoteNote(fact))
    }
  }
  const intakes = []
  for (const i of p.intakes ?? []) {
    const why = evidenceProblem(i) ?? (Number.isInteger(i.month) && i.month >= 1 && i.month <= 12 && (i.year == null || Number.isInteger(i.year)) && (i.applicationDeadline == null || ISO_DATE.test(i.applicationDeadline)) ? null : 'invalid month, year or deadline')
    if (why) skipped.push(p.slug + ' intake: ' + why)
    else intakes.push({ row: { intake_month: i.month, intake_year: i.year ?? null, application_deadline: i.applicationDeadline ?? null }, source: { url: i.sourceUrl, publisher: i.publisher ?? p.evidence.publisher, checkedAt: i.checkedAt }, notes: quoteNote(i) })
  }
  const fees = []
  for (const t of p.fees ?? []) {
    const bad = [
      !FEE_CATEGORIES.includes(t.category) && 'fee category',
      !BILLING_PERIODS.includes(t.billingPeriod) && 'billing period',
      !CURRENCIES.includes(t.currency) && 'currency',
      t.amount != null && !/^\d{1,12}(\.\d{1,2})?$/.test(String(t.amount)) && 'amount',
      t.amount != null && Number(t.amount) <= 0 && 'amount (record no tuition as amount null with a note, never 0)',
      t.amount == null && !String(t.notes ?? '').trim() && 'a missing amount needs a note saying why',
      t.academicYear != null && !/^\d{4}(-\d{4})?$/.test(t.academicYear) && 'academic year',
    ].filter(Boolean)
    const why = evidenceProblem(t) ?? (bad.length ? 'invalid ' + bad.join(', ') : null)
    if (why) skipped.push(p.slug + ' fee: ' + why)
    else
      fees.push({
        row: { fee_category: t.category, amount: t.amount == null ? null : String(t.amount), currency: t.currency, billing_period: t.billingPeriod, academic_year: t.academicYear ?? null, fee_notes: t.notes ?? null },
        source: { url: t.sourceUrl, publisher: t.publisher ?? p.evidence.publisher, checkedAt: t.checkedAt },
        notes: quoteNote(t),
      })
  }
  return {
    course: { row, notes, campus: typeof p.campus === 'string' && p.campus.trim() ? p.campus.trim() : null, source: { url: p.evidence.sourceUrl, publisher: p.evidence.publisher, checkedAt: p.evidence.checkedAt } },
    intakes,
    fees,
    skipped,
  }
}

/** Reads <dir>/enrichment/*.json. Later files never replace an earlier programme with the same key. */
export function loadEnrichment(dir) {
  const folder = path.join(dir, 'enrichment')
  let files = []
  try {
    files = readdirSync(folder).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return []
  }
  const out = []
  for (const file of files) {
    const data = JSON.parse(readFileSync(path.join(folder, file), 'utf8'))
    if (data.format !== 'lockin-enrichment-v1' || data.status !== 'pending_admin_entry') throw new Error(file + ': expected format lockin-enrichment-v1 with status pending_admin_entry')
    for (const u of data.universities ?? []) out.push({ ...u, _file: file })
  }
  return out
}

/** Adds researched programmes to existing universities, one transaction per university. */
export async function enrichUniversities(pool, items) {
  const summary = { universitiesEnriched: 0, universitiesMissing: [], coursesCreated: 0, coursesExisting: 0, requirementsAdded: 0, campusesCreated: 0, intakesCreated: 0, intakesExisting: 0, feesCreated: 0, feesExisting: 0, sourcesCreated: 0, skipped: [], failed: [] }
  for (const u of items) {
    const key = u.destinationIso2 + ':' + u.slug
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [[uni]] = await conn.query('SELECT id FROM universities WHERE destination_iso2 = ? AND slug = ? FOR UPDATE', [u.destinationIso2, u.slug])
      if (!uni) {
        summary.universitiesMissing.push(key)
        await conn.commit()
        continue
      }
      let touched = false
      for (const programme of u.programmes ?? []) {
        const plan = planProgramme(programme)
        summary.skipped.push(...plan.skipped.map((x) => key + ' ' + x))
        if (!plan.course) continue
        const [[existing]] = await conn.query('SELECT * FROM courses WHERE university_id = ? AND slug = ? FOR UPDATE', [uni.id, plan.course.row.slug])
        let courseId
        if (existing) {
          courseId = Number(existing.id)
          summary.coursesExisting += 1
          // Fill only empty requirement fields of a course nobody has verified yet; never overwrite.
          const fill = Object.fromEntries(['entry_requirements', 'language_requirements'].filter((c) => existing[c] == null && plan.course.row[c] != null).map((c) => [c, plan.course.row[c]]))
          if (Object.keys(fill).length && existing.verification_status === 'unverified' && existing.publication_status !== 'published') {
            await conn.query('UPDATE courses SET ?, verification_notes = CONCAT(COALESCE(verification_notes, \'\'), ?) WHERE id = ?', [fill, '\n\n' + plan.course.notes.slice(1).join('\n\n'), courseId])
            const [[after]] = await conn.query('SELECT * FROM courses WHERE id = ?', [courseId])
            await appendChangeLogRow(conn, { entityType: 'course', entityId: courseId, action: 'update', actorId: ACTOR, actorRole: 'cli', reason: 'Research import: filled empty requirement fields', before: existing, after })
            summary.requirementsAdded += Object.keys(fill).length
            touched = true
          }
        } else {
          const sourceId = await findOrCreateSource(conn, plan.course.source, summary)
          let campusId = null
          if (plan.course.campus) {
            const [[campus]] = await conn.query('SELECT id FROM campuses WHERE university_id = ? AND name = ?', [uni.id, plan.course.campus.slice(0, 200)])
            if (campus) campusId = Number(campus.id)
            else {
              campusId = await createForReview(conn, 'campus', 'campuses', { university_id: uni.id, name: plan.course.campus.slice(0, 200), source_id: sourceId }, plan.course.notes[0])
              summary.campusesCreated += 1
            }
          }
          courseId = await createForReview(conn, 'course', 'courses', { ...plan.course.row, university_id: uni.id, campus_id: campusId, source_id: sourceId }, plan.course.notes.join('\n\n'))
          summary.coursesCreated += 1
          touched = true
        }
        for (const i of plan.intakes) {
          const [dup] = await conn.query('SELECT id FROM course_intakes WHERE course_id = ? AND intake_month = ? AND intake_year <=> ?', [courseId, i.row.intake_month, i.row.intake_year])
          if (dup.length) {
            summary.intakesExisting += 1
            continue
          }
          await createForReview(conn, 'course_intake', 'course_intakes', { ...i.row, course_id: courseId, source_id: await findOrCreateSource(conn, i.source, summary) }, i.notes)
          summary.intakesCreated += 1
          touched = true
        }
        for (const t of plan.fees) {
          const [dup] = await conn.query('SELECT id FROM tuition_fees WHERE course_id = ? AND fee_category = ? AND academic_year <=> ? AND billing_period = ? AND currency = ?', [courseId, t.row.fee_category, t.row.academic_year, t.row.billing_period, t.row.currency])
          if (dup.length) {
            summary.feesExisting += 1
            continue
          }
          await createForReview(conn, 'tuition_fee', 'tuition_fees', { ...t.row, course_id: courseId, source_id: await findOrCreateSource(conn, t.source, summary) }, t.notes)
          summary.feesCreated += 1
          touched = true
        }
      }
      if (touched) summary.universitiesEnriched += 1
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      summary.failed.push(key + ': ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      conn.release()
    }
  }
  return summary
}

async function backup(pool, dir) {
  const out = {}
  for (const table of DIRECTORY_TABLES) out[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0]
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `directory-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(out, null, 1))
  return { file, rows: Object.fromEntries(Object.entries(out).map(([t, rows]) => [t, rows.length])) }
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, apply: { type: 'boolean' }, 'allow-remote': { type: 'boolean' }, 'backup-dir': { type: 'string' }, 'check-websites': { type: 'boolean' }, 'universities-only': { type: 'boolean' }, 'identity-from': { type: 'string' }, enrich: { type: 'boolean' } } })
  const dir = values.dir ?? process.env.LOCKIN_RESEARCH_DIR
  if (!dir) throw new Error('Give the private research folder with --dir (or LOCKIN_RESEARCH_DIR).')
  if (process.env.NODE_ENV === 'production') throw new Error('The research import is for a local database only.')

  const { records, duplicates, conflicts } = loadResearch(dir)
  const plans = records.map((r) => ({ r, plan: planRecord(r) }))
  const perDestination = {}
  const missing = {}
  for (const { r, plan } of plans) {
    const d = (perDestination[r.destinationIso2] ??= { universities: 0, courses: 0, intakes: 0, fees: 0 })
    if (plan.university) d.universities += 1
    if (plan.course) d.courses += 1
    if (plan.intake) d.intakes += 1
    if (plan.fee) d.fees += 1
    for (const s of plan.skipped) missing[s] = (missing[s] ?? 0) + 1
  }
  console.log(`Research: ${records.length} distinct universities; ${duplicates.length} duplicate copies (${conflicts.length} with different content).`)
  for (const c of conflicts) console.log(`  CONFLICT ${c.key}: ${c.file} differs from ${c.keptFrom} (kept)`)
  console.table(perDestination)
  console.log('Not imported (missing or insufficient evidence):')
  console.table(missing)

  const enrichment = values.enrich ? loadEnrichment(dir) : []
  if (values.enrich) {
    const plans = enrichment.flatMap((u) => (u.programmes ?? []).map((p) => ({ u, plan: planProgramme(p) })))
    const byDest = {}
    for (const { u, plan } of plans) {
      const d = (byDest[u.destinationIso2] ??= { universities: new Set(), courses: 0, intakes: 0, fees: 0, entry: 0, language: 0 })
      d.universities.add(u.slug)
      if (!plan.course) continue
      d.courses += 1
      d.intakes += plan.intakes.length
      d.fees += plan.fees.length
      if (plan.course.row.entry_requirements) d.entry += 1
      if (plan.course.row.language_requirements) d.language += 1
    }
    console.log('Enrichment research (programme-level, quoted):')
    console.table(Object.fromEntries(Object.entries(byDest).map(([k, v]) => [k, { ...v, universities: v.universities.size }])))
    for (const { u, plan } of plans) for (const x of plan.skipped) console.log('  NOT USED ' + u.destinationIso2 + ':' + u.slug + ' ' + x)
  }

  if (!values.apply) {
    console.log('Dry run: nothing written. Add --apply to import into the local database.')
    return
  }
  const uri = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL
  if (!uri) throw new Error('DATABASE_URL is not set. Start the local sandbox first (pnpm dev:local) and load .env.sandbox.local.')
  const host = new URL(uri).hostname
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) && !values['allow-remote'])
    throw new Error('Refusing a non-local database. Use --allow-remote only for an approved staging import, after a backup.')

  const pool = mysql.createPool({ uri, dateStrings: true, timezone: 'Z', connectionLimit: 2 })
  enforceSession(pool)
  try {
    const saved = await backup(pool, values['backup-dir'] ?? path.join(dir, 'import-backups'))
    console.log(`Backup of the directory tables before import: ${saved.file}`, saved.rows)
    const identity = values['identity-from'] ? new Map(JSON.parse(readFileSync(values['identity-from'], 'utf8')).map((r) => [r.key, r])) : null
    const summary = await importResearch(pool, records, { checkWebsite: values['check-websites'] ? checkWebsite : null, universitiesOnly: Boolean(values['universities-only']), identity })
    console.log('Imported for review (draft → in review, unverified, unpublished):', { ...summary, held: summary.held.length, failed: summary.failed.length })
    for (const h of summary.held) console.log('  PENDING (in review, listed by name only: identity/source check pending) ' + h)
    for (const f of summary.failed) console.log(`  FAILED ${f}`)
    if (summary.failed.length) process.exitCode = 1
    if (values.enrich) {
      const e = await enrichUniversities(pool, enrichment)
      console.log('Enriched for review (new rows: draft → in review, unverified, unpublished):', { ...e, universitiesMissing: e.universitiesMissing.length, skipped: e.skipped.length, failed: e.failed.length })
      for (const m of e.universitiesMissing) console.log('  NOT IN DATABASE ' + m)
      for (const f of e.failed) console.log('  FAILED ' + f)
      if (e.failed.length) process.exitCode = 1
    }
  } finally {
    await pool.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
