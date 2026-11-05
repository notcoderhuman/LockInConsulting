import type { RowDataPacket } from 'mysql2/promise'
import { todayIso } from '@/lib/data/publication'
import { fetchDestinationDirectory, type Queryable } from '@/lib/db/directory-queries'
import type { SourceRef } from '@/lib/data/types'
import { MONTH_NAMES } from '@/lib/admin/entities'
import { detectDestinations } from './guidance'
import type { EvidenceItem } from './provider'

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
  const matched = unis
    .filter((u) => q.includes(` ${norm(String(u.name))} `) || q.includes(` ${norm(String(u.slug))} `))
    .slice(0, MAX_UNIVERSITIES)
  if (!matched.length) return destinationListings(db, question, today)

  // A comparison gets an even share per university, so the first one cannot crowd out the others.
  const perUniversity = Math.floor(MAX_ITEMS / matched.length)
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
      items.push(...own.slice(0, perUniversity))
    }
  }
  return items
}

/**
 * Broad questions ("Tell me about UK universities", "UK or Germany?") name destinations but no
 * university. Offer only each destination's published, verified directory listings (name, city,
 * official website) so Derek can point to them; never facts about them that the student did not ask for.
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
  }
  return items
}
