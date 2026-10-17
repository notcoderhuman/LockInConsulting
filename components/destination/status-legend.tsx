import type { DisplayState } from '@/lib/data/publication'
import { DataStatusBadge, DISPLAY_STATE_DESCRIPTION } from './data-status-badge'
import { SectionHeading } from './section-heading'

const ORDER: DisplayState[] = ['verified', 'unavailable', 'unverified', 'expired', 'unpublished']

export function StatusLegend() {
  return (
    <section aria-labelledby="data-status-title" id="data-status" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <SectionHeading id="data-status-title" eyebrow="How we verify" title="What each label means">
          <p>
            Every figure we show links to its official source and the date we checked it. Only verified figures, or
            confirmed &ldquo;not publicly available&rdquo; notes, appear on this page.
          </p>
        </SectionHeading>
        <dl className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
          {ORDER.map((state) => (
            <div key={state} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:gap-6">
              <dt className="shrink-0 sm:w-48">
                <DataStatusBadge state={state} />
              </dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{DISPLAY_STATE_DESCRIPTION[state]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
