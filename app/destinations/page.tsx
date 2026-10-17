import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { DESTINATIONS, destinationHref, type DestinationRegion } from '@/lib/destinations'

export const metadata: Metadata = {
  title: 'Destinations · LockIn Consulting',
  description: 'The 11 study-abroad destinations LockIn Consulting covers, with official sources for each.',
  alternates: { canonical: '/destinations' },
}

const REGIONS: DestinationRegion[] = ['North America', 'Europe', 'Oceania', 'Middle East']

export default function DestinationsPage() {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-7xl px-5 pb-20 pt-10 md:px-8 md:pt-14">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">11 destinations</p>
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground md:text-6xl">
            Where you could study
          </h1>
          <p className="text-base leading-relaxed text-pretty text-muted-foreground">
            Each destination page links to official sources and lists universities only after we&apos;ve verified them.
          </p>
        </div>

        <div className="mt-12 flex flex-col gap-12">
          {REGIONS.map((region) => {
            const items = DESTINATIONS.filter((d) => d.region === region)
            return (
              <section key={region} aria-labelledby={`region-${region}`} className="flex flex-col gap-4">
                <h2 id={`region-${region}`} className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  {region}
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((d) => (
                    <li key={d.iso2}>
                      <Link
                        href={destinationHref(d)}
                        className="group flex min-h-11 items-center justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/50"
                      >
                        <span className="flex flex-col">
                          <span className="font-serif text-2xl text-foreground">{d.name}</span>
                          <span className="font-mono text-xs tracking-widest text-muted-foreground">
                            {d.iso3}
                            {d.subRegions?.length ? ` · incl. ${d.subRegions.map((s) => s.name).join(', ')}` : ''}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
