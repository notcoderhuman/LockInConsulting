import { ArrowUpRight } from 'lucide-react'
import { formatIsoDate } from '@/lib/data/money'
import { RESOURCE_KIND_LABEL, type OfficialResource } from '@/lib/content/official-resources'
import type { Destination } from '@/lib/destinations'
import { SectionHeading } from './section-heading'

export function OfficialResources({ destination, resources }: { destination: Destination; resources: OfficialResource[] }) {
  return (
    <section aria-labelledby="admissions-title" id="admissions" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-16 md:px-8">
        <SectionHeading id="admissions-title" eyebrow="Admissions & visas" title="Go to the official source">
          <p>
            Entry requirements, deadlines and visa rules change, and they differ between universities. Until our team
            has verified a requirement, we link to the official publisher instead of summarising it. Read the current
            rules there before you apply.
          </p>
        </SectionHeading>

        {resources.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((r) => (
              <li key={r.url}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full min-h-11 flex-col gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
                >
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{RESOURCE_KIND_LABEL[r.kind]}</span>
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-serif text-xl leading-snug text-foreground">{r.title}</span>
                    <ArrowUpRight className="mt-1 size-4 shrink-0 text-primary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <span className="text-sm text-muted-foreground">{r.publisher}</span>
                  <span className="mt-auto text-xs text-muted-foreground">
                    Link checked {formatIsoDate(r.linkCheckedAt)}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Official resources for {destination.shortName} are pending a link check.
          </p>
        )}

        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          &ldquo;Link checked&rdquo; means the page loaded from its official address on that date. It doesn&apos;t mean
          we&apos;ve reviewed what the page says. LockIn provides general guidance, not immigration advice.
        </p>
      </div>
    </section>
  )
}
