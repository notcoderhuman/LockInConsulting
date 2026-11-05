import { QUALIFICATION_LABEL } from './labels'
import { formatIsoDate } from './money'
import type { DirectoryEntry } from './types'

/**
 * The plain text "Copy information" puts on the clipboard: only what the profile page shows, with its
 * source. No verification status (owner decision, 5 Nov 2026: status stays in the database and admin).
 * Rankings are left out on purpose (licence terms cover display on the page, not reuse); tuition stays
 * on the page next to its source and exchange-rate date.
 */
export function profileText(entry: DirectoryEntry, destinationName: string, pageUrl: string): string {
  const lines = [entry.name]
  if (entry.listing === 'provisional') {
    const checked = entry.identityStatus === 'checked' && entry.officialWebsite
    lines.push(checked ? `Official website checked ${formatIsoDate(entry.identityCheckedAt ?? '')}.` : 'The official website has not been confirmed yet.')
    if (entry.category === 'other') lines.push('Institution type: other institution type, classification pending')
    lines.push(`Destination: ${destinationName}`)
    if (checked && entry.city) lines.push(`City: ${entry.city} (as stated on the official website)`)
    if (checked) lines.push(`Official website: ${entry.officialWebsite}`)
    lines.push('Courses, tuition, rankings and entry requirements: still being checked, so not shown.')
  } else {
    const location = [entry.city, entry.subRegion].filter(Boolean).join(', ')
    lines.push(`Source: ${entry.source.publisher}, ${entry.source.url} (checked ${formatIsoDate(entry.source.checkedAt)})`)
    lines.push(`Destination: ${destinationName}`)
    if (location) lines.push(`Location: ${location}`)
    if (entry.institutionType !== 'unknown') lines.push(`Type: ${entry.institutionType === 'public' ? 'Public' : 'Private'}`)
    lines.push(`Official website: ${entry.officialWebsite}`)
    lines.push(
      entry.courses.length
        ? `Courses: ${entry.courses.map((c) => `${c.name} (${QUALIFICATION_LABEL[c.qualification]}, ${c.studyLevel})`).join('; ')}`
        : 'Courses: none published yet.',
    )
    lines.push('Tuition, intakes and any licensed rankings are on the LockIn page with their sources.')
  }
  lines.push(`LockIn page: ${pageUrl}`)
  return lines.join('\n')
}
