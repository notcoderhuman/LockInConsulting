import { QUALIFICATION_LABEL } from './labels'
import { formatIsoDate } from './money'
import type { DirectoryEntry } from './types'

/**
 * The plain text "Copy information" puts on the clipboard: only what the profile page shows, always
 * with its verification status and source. Rankings are left out on purpose (licence terms cover
 * display on the page, not reuse); tuition stays on the page next to its source and exchange-rate date.
 */
export function profileText(entry: DirectoryEntry, destinationName: string, pageUrl: string): string {
  const lines = [entry.name]
  if (entry.listing === 'provisional') {
    const checked = entry.identityStatus === 'checked' && entry.officialWebsite
    lines.push(
      checked
        ? `Status: Not yet verified. Official website checked ${formatIsoDate(entry.identityCheckedAt ?? '')}; this is not a verified LockIn profile.`
        : 'Status: Not yet verified. Identity/source check pending; the official website has not been confirmed.',
    )
    if (entry.category === 'other') lines.push('Institution type: other institution type, classification pending')
    lines.push(`Destination: ${destinationName}`)
    if (checked && entry.city) lines.push(`City: ${entry.city} (as stated on the official website)`)
    if (checked) lines.push(`Official website: ${entry.officialWebsite}`)
    lines.push('Courses, tuition, rankings and entry requirements: not yet verified, so not shown.')
  } else {
    const location = [entry.city, entry.subRegion].filter(Boolean).join(', ')
    lines.push(`Status: Verified by LockIn. Source: ${entry.source.publisher}, ${entry.source.url} (checked ${formatIsoDate(entry.source.checkedAt)})`)
    lines.push(`Destination: ${destinationName}`)
    if (location) lines.push(`Location: ${location}`)
    if (entry.institutionType !== 'unknown') lines.push(`Type: ${entry.institutionType === 'public' ? 'Public' : 'Private'}`)
    lines.push(`Official website: ${entry.officialWebsite}`)
    lines.push(
      entry.courses.length
        ? `Verified courses: ${entry.courses.map((c) => `${c.name} (${QUALIFICATION_LABEL[c.qualification]}, ${c.studyLevel})`).join('; ')}`
        : 'Verified courses: none published yet.',
    )
    lines.push('Tuition, intakes and any licensed rankings are on the LockIn page with their sources.')
  }
  lines.push(`LockIn page: ${pageUrl}`)
  return lines.join('\n')
}
