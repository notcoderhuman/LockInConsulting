import { ArrowUpRight } from 'lucide-react'
import { APPLICANT_SCOPE_LABEL, QUALIFICATION_LABEL, STUDY_MODE_LABEL, formatDuration, monthLabel } from '@/lib/data/labels'
import type { PublicCourse, PublicUniversity } from '@/lib/data/types'
import { DataStatusBadge } from './data-status-badge'
import { SourceCitation } from './source-citation'
import { TuitionFee } from './tuition-fee'

function Pending({ label }: { label: string }) {
  return <span className="text-sm text-muted-foreground">{label}</span>
}

function formatRequirementsText(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val
  if (typeof val === 'object') {
    const v = val as Record<string, unknown>
    const parts: string[] = []
    if (v.minimumGpa) parts.push(`Minimum GPA: ${v.minimumGpa}`)
    if (v.prerequisites) parts.push(`Prerequisites: ${v.prerequisites}`)
    if (v.greRequired !== undefined) parts.push(v.greRequired ? 'GRE: Required' : 'GRE: Not required')
    if (v.ieltsMin) parts.push(`IELTS: Minimum overall ${v.ieltsMin}`)
    if (v.toeflMin) parts.push(`TOEFL iBT: Minimum ${v.toeflMin}`)
    for (const [k, item] of Object.entries(v)) {
      if (!['minimumGpa', 'prerequisites', 'greRequired', 'ieltsMin', 'toeflMin'].includes(k) && (typeof item === 'string' || typeof item === 'number')) {
        parts.push(`${k}: ${item}`)
      }
    }
    return parts.length ? parts.join('\n') : JSON.stringify(val)
  }
  return String(val)
}

function CourseRow({ course }: { course: PublicCourse }) {
  const duration = formatDuration(course.durationMonths)
  const entryText = formatRequirementsText(course.entryRequirements)
  const langText = formatRequirementsText(course.languageRequirements)
  return (
    <li className="grid gap-4 border-t border-border py-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">{course.name}</p>
        <p className="text-sm text-muted-foreground">
          {QUALIFICATION_LABEL[course.qualification]} · {course.studyLevel}
          {course.studyMode ? ` · ${STUDY_MODE_LABEL[course.studyMode]}` : ''}
          {course.teachingLanguage ? ` · Taught in ${course.teachingLanguage}` : ''}
        </p>
        <SourceCitation source={course.source} />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-1">
        <div>
          <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Duration</dt>
          <dd className="text-foreground">{duration ?? <Pending label="Not verified" />}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Intakes</dt>
          <dd className="text-foreground">
            {course.intakes.length ? (
              course.intakes.map((i) => `${monthLabel(i.month)}${i.year ? ` ${i.year}` : ''}`).join(', ')
            ) : (
              <Pending label="Not verified" />
            )}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tuition</p>
          {course.fees.length ? (
            <ul className="mt-1 flex flex-col gap-3">
              {course.fees.map((fee) => (
                <li key={fee.id}>
                  <TuitionFee fee={fee} />
                </li>
              ))}
            </ul>
          ) : (
            <DataStatusBadge state="unverified" className="mt-1" />
          )}
        </div>
        {(entryText || langText) && (
          <details className="group text-sm">
            <summary className="min-h-11 cursor-pointer content-center text-primary">Entry requirements</summary>
            <div className="flex flex-col gap-2 pt-2 leading-relaxed text-muted-foreground">
              {entryText && <p className="whitespace-pre-line">{entryText}</p>}
              {langText && <p className="whitespace-pre-line">{langText}</p>}
            </div>
          </details>
        )}
      </div>
    </li>
  )
}

export function UniversityCard({ university }: { university: PublicUniversity }) {
  const location = [university.city, university.subRegion].filter(Boolean).join(', ')
  return (
    <article aria-labelledby={`uni-${university.id}`} className="rounded-2xl border border-border bg-card p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h3 id={`uni-${university.id}`} className="font-serif text-2xl leading-snug text-foreground">
            {university.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {location || 'Location not verified'}
            {university.institutionType !== 'unknown' ? ` · ${university.institutionType === 'public' ? 'Public' : 'Private'}` : ''}
          </p>
          <SourceCitation source={university.source} />
        </div>
        <a
          href={university.officialWebsite}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-full border border-primary/50 px-4 text-sm text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          Official website <ArrowUpRight className="size-4" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </header>

      <div className="mt-6 grid gap-6 border-t border-border pt-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Acceptance rate</p>
          {university.acceptanceRates.length ? (
            <ul className="flex flex-col gap-3">
              {university.acceptanceRates.map((a) => (
                <li key={a.id} className="flex flex-col gap-1">
                  {a.status === 'unavailable' || a.ratePercent == null ? (
                    <DataStatusBadge state="unavailable" className="self-start" />
                  ) : (
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{Number(a.ratePercent)}%</span>{' '}
                      <span className="text-muted-foreground">
                        {APPLICANT_SCOPE_LABEL[a.scope]} · {a.cohortLabel}
                      </span>
                    </p>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">Definition: {a.definition}</p>
                  <SourceCitation source={a.source} />
                </li>
              ))}
            </ul>
          ) : (
            <DataStatusBadge state="unverified" className="self-start" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">World ranking</p>
          {university.rankings.length ? (
            <ul className="flex flex-col gap-3">
              {university.rankings.map((r) => (
                <li key={r.id} className="flex flex-col gap-1">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">
                      {r.position != null ? `#${r.position}` : `${r.bandLow}–${r.bandHigh}`}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      {r.providerName} {r.year}
                      {r.subject ? ` · ${r.subject}` : ''}
                    </span>
                  </p>
                  <SourceCitation source={r.source} />
                </li>
              ))}
            </ul>
          ) : (
            <DataStatusBadge state="unpublished" className="self-start" />
          )}
        </div>
      </div>

      <div className="mt-6">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Courses</p>
        {university.courses.length ? (
          <ul className="mt-2">
            {university.courses.map((c) => (
              <CourseRow key={c.id} course={c} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No verified courses published yet.</p>
        )}
      </div>
    </article>
  )
}
