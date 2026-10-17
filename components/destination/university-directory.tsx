import type { DirectoryResult } from '@/lib/data/types'
import type { Destination } from '@/lib/destinations'
import { DataStatusBadge } from './data-status-badge'
import { SectionHeading } from './section-heading'
import { UniversityCard } from './university-card'

const LISTING_FIELDS = [
  { group: 'University', items: ['Official website', 'City, campus and emirate or region', 'Public or private status'] },
  { group: 'Courses', items: ['Qualification and UG/PG level', 'Duration and study mode', 'Intake months and deadlines', 'Entry and language requirements'] },
  {
    group: 'Tuition',
    items: ['Amount in the original currency', 'Billing period and academic year', 'Approximate INR, with the rate date and source'],
  },
  { group: 'Every figure', items: ['Official source link', 'Date checked', 'Verification status'] },
] as const

function EmptyDirectory({ destination, failed }: { destination: Destination; failed: boolean }) {
  return (
    <div className="grid gap-8 rounded-2xl border border-border bg-card p-6 md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="flex flex-col gap-3">
        {!failed && <DataStatusBadge state="unverified" className="self-start" />}
        <p className="font-serif text-2xl leading-snug text-balance text-foreground">
          {failed ? 'The directory is temporarily unavailable.' : `No verified ${destination.shortName} listings yet.`}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {failed
            ? 'We could not load verified listings just now. Nothing is shown in their place. Please try again later.'
            : 'Our team is checking each university against its official website before anything goes live. Until then, this space stays empty rather than showing estimates.'}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Each listing will show</p>
        <dl className="mt-4 grid gap-6 sm:grid-cols-2">
          {LISTING_FIELDS.map((f) => (
            <div key={f.group}>
              <dt className="text-sm font-medium text-foreground">{f.group}</dt>
              <dd>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                  {f.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

export function UniversityDirectory({ destination, directory }: { destination: Destination; directory: DirectoryResult }) {
  const universities = directory.state === 'ready' ? directory.universities : []
  return (
    <section aria-labelledby="universities-title" id="universities" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-16 md:px-8">
        <SectionHeading id="universities-title" eyebrow="Directory" title={`Universities in ${destination.shortName}`}>
          <p>
            Courses and tuition sit under each university. Fees are shown in the currency the university uses, with
            an approximate INR figure only when we hold an exchange rate from the last 7 days.
          </p>
        </SectionHeading>

        {universities.length > 0 ? (
          <ul className="flex flex-col gap-6">
            {universities.map((u) => (
              <li key={u.id}>
                <UniversityCard university={u} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyDirectory destination={destination} failed={directory.state === 'error'} />
        )}
      </div>
    </section>
  )
}
