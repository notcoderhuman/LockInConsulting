import type { RowDataPacket } from 'mysql2/promise'
import { todayIso } from '@/lib/data/publication'
import { fetchDestinationDirectory, type Queryable } from '@/lib/db/directory-queries'
import { MONTH_NAMES } from '@/lib/admin/entities'
import { detectDestinations } from './guidance'
import type { EvidenceItem } from './provider'

// Derek's only knowledge source: the same public_* views the website renders. Those views already
// exclude drafts, unverified and expired records, fees past valid_to, rankings without reuse
// rights, and unapproved exchange rates. Nothing here reads base tables, db/intake/ research files,
// the rejected PDF, or any hard-coded list. INR is never computed for Derek.

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

export async function loadEvidence(db: Queryable, question: string, today = todayIso()): Promise<EvidenceItem[]> {
  const [unis] = await db.query<RowDataPacket[]>('SELECT id, name, slug, destination_iso2 FROM public_universities')
  const q = ` ${norm(question)} `
  const matched = unis
    .filter((u) => q.includes(` ${norm(String(u.name))} `) || q.includes(` ${norm(String(u.slug))} `))
    .slice(0, MAX_UNIVERSITIES)
  if (!matched.length) return destinationListings(db, question, today)

  const items: EvidenceItem[] = []
  for (const iso of new Set(matched.map((u) => String(u.destination_iso2)))) {
    const directory = await fetchDestinationDirectory(db, iso, today)
    for (const u of directory.filter((d) => matched.some((m) => Number(m.id) === d.id))) {
      items.push({ ref: `university:${u.id}`, text: `${u.name}, official website ${u.officialWebsite}`, sourceUrl: u.source.url, checkedAt: u.source.checkedAt })
      for (const r of u.rankings) {
        const pos = r.position != null ? `#${r.position}` : `${r.bandLow}–${r.bandHigh}`
        items.push({ ref: `university_ranking:${r.id}`, text: `${u.name} ranking: ${r.providerName} ${r.year}${r.subject ? ` (${r.subject})` : ''}: ${pos}`, sourceUrl: r.source.url, checkedAt: r.source.checkedAt })
      }
      for (const a of u.acceptanceRates) {
        if (a.ratePercent == null) continue
        items.push({ ref: `acceptance_rate:${a.id}`, text: `${u.name} acceptance rate (${a.cohortLabel}): ${a.ratePercent}% — ${a.definition}`, sourceUrl: a.source.url, checkedAt: a.source.checkedAt })
      }
      for (const c of u.courses) {
        items.push({ ref: `course:${c.id}`, text: `${u.name} offers ${c.name}${c.durationMonths ? `, ${c.durationMonths} months` : ''}`, sourceUrl: c.source.url, checkedAt: c.source.checkedAt })
        if (c.entryRequirements)
          items.push({ ref: `course:${c.id}:requirements`, text: `${c.name} entry requirements: ${c.entryRequirements}`, sourceUrl: c.source.url, checkedAt: c.source.checkedAt })
        if (c.languageRequirements)
          items.push({ ref: `course:${c.id}:language`, text: `${c.name} language requirements: ${c.languageRequirements}`, sourceUrl: c.source.url, checkedAt: c.source.checkedAt })
        for (const f of c.fees) {
          if (f.amount == null || isStaleAcademicYear(f.academicYear, today)) continue
          items.push({
            ref: `tuition_fee:${f.id}`,
            text: `${c.name} tuition fee (${f.category.replace(/_/g, ' ')}): ${f.currency} ${f.amount} ${f.billingPeriod.replace(/_/g, ' ')}${f.academicYear ? `, academic year ${f.academicYear}` : ''}`,
            sourceUrl: f.source.url,
            checkedAt: f.source.checkedAt,
          })
        }
        for (const i of c.intakes) {
          items.push({
            ref: `course_intake:${i.id}`,
            text: `${c.name} intake: ${MONTH_NAMES[i.month - 1]}${i.year ? ` ${i.year}` : ''}${i.applicationDeadline ? `, application deadline ${i.applicationDeadline}` : ''}`,
            sourceUrl: i.source.url,
            checkedAt: i.source.checkedAt,
          })
        }
      }
    }
  }
  return items.slice(0, MAX_ITEMS)
}

/**
 * Broad questions ("Tell me about UK universities") name a destination but no university. Offer
 * only the destination's published, verified directory listings (name, city, official website) so
 * Derek can point to them; never facts about them that the student did not ask for.
 */
async function destinationListings(db: Queryable, question: string, today: string): Promise<EvidenceItem[]> {
  const items: EvidenceItem[] = []
  for (const destination of detectDestinations(question).slice(0, 2)) {
    const listed = await fetchDestinationDirectory(db, destination.iso2, today)
    for (const u of listed.slice(0, MAX_LISTINGS_PER_DESTINATION))
      items.push({
        ref: `university:${u.id}`,
        text: `${u.name}${u.city ? `, ${u.city}` : ''} (${destination.shortName}) is listed in the LockIn directory; official website ${u.officialWebsite}`,
        sourceUrl: u.source.url,
        checkedAt: u.source.checkedAt,
      })
  }
  return items
}
