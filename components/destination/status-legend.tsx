import type { DisplayState } from '@/lib/data/publication'
import { DataStatusBadge, DISPLAY_STATE_DESCRIPTION } from './data-status-badge'
import { SectionHeading } from './section-heading'

const ORDER: DisplayState[] = ['verified', 'unavailable', 'unverified', 'expired', 'unpublished']

export function StatusLegend() {
  return (
    <section aria-labelledby="data-status-title" id="data-status" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-16 md:px-8">
        <SectionHeading id="data-status-title" eyebrow="How we verify" title="What each status label means">
          <p>
            Every figure links to its official source and the date we checked it. Figures appear only when verified, or
            with a note that the official source does not publish them.
          </p>
        </SectionHeading>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ORDER.map((state) => (
            <div key={state} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
              <dt>
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
